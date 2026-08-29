import { createSignal, Show, type JSX } from 'solid-js'

// A titled disclosure section. github's PullDetail is eight of these in a column, each hand-written
// with its own localStorage closure across three different mechanisms, two of them missing
// `aria-expanded`. See docs/ui-design.md § The closed kit for why it uses native `<details>` and has
// no accordion mode.
//
// Named `Fold` since the kit closed; `CollapsibleSection` is the same component under its old name
// and goes away in phase 9 of the layout programme.

// Reading and writing one localStorage key is the same carve-out ui/diff/DiffRows.tsx has for draft
// state, and is why this is a component rather than a caller responsibility: the eight github sites each
// hand-wrote the same closure, and the one that mattered, the fold you left open, was the one people got
// wrong.
const readOpen = (key: string | undefined, fallback: boolean): boolean => {
  if (!key) return fallback
  try {
    const stored = localStorage.getItem(`fold:${key}`)
    return stored === null ? fallback : stored === '1'
  } catch {
    return fallback
  }
}

const writeOpen = (key: string | undefined, open: boolean): void => {
  if (!key) return
  try {
    localStorage.setItem(`fold:${key}`, open ? '1' : '0')
  } catch {
    // A private-mode or quota failure must not take the fold with it.
  }
}

/* At 80×24: `▸ label` or `▾ label`, the children indented two cells. */
export function Fold(props: {
  label: string
  count?: number
  /** Beside the label rather than after the actions: context's per-section Meter, docker's stream
   *  state. A fact about the fold, not a control on it. */
  meta?: JSX.Element
  /** Rendered in the summary row and click-isolated from the toggle: a CopyButton in a fold's header
   *  must not open the fold. */
  actions?: JSX.Element
  level?: 'pane' | 'group' | 'sub'
  persistKey?: string
  /** Where the fold starts, when nothing has been stored under `persistKey`. */
  defaultOpen?: boolean
  /** Controlled mode, and all of it: supplying `onOpenChange` hands the state to the caller for
   *  every operation. See docs/ui-design.md § The closed kit for why the kit never mixes the two. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: JSX.Element
}) {
  const [local, setLocal] = createSignal(readOpen(props.persistKey, props.defaultOpen ?? false))
  const open = () => (props.onOpenChange ? props.open ?? false : local())

  return (
    <details
      class="ui-fold"
      open={open()}
      onToggle={(event) => {
        const next = event.currentTarget.open
        if (next === open()) return
        setLocal(next)
        writeOpen(props.persistKey, next)
        props.onOpenChange?.(next)
      }}
    >
      {/* The shared `.section-header` class, not a parallel one — SectionHeader emits it too, so a
          pack styles both with one selector. */}
      <summary class="section-header ui-fold-summary" data-level={props.level ?? 'group'}>
        <span class="ui-fold-marker" aria-hidden="true" />
        <span class="ui-section-header-label">{props.label}</span>
        <Show when={props.count != null}><span class="ui-section-header-count">{props.count}</span></Show>
        <Show when={props.meta}><span class="ui-fold-meta">{props.meta}</span></Show>
        <Show when={props.actions}>
          <span class="ui-section-header-actions" onClick={(event) => event.stopPropagation()}>
            {props.actions}
          </span>
        </Show>
      </summary>
      {props.children}
    </details>
  )
}

/** @deprecated The kit calls this `Fold`. Removed in phase 9 of the layout programme. */
export const CollapsibleSection = Fold
