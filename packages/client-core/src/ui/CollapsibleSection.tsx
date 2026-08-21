import { createSignal, Show, type JSX } from 'solid-js'
import { cx } from './cx'

// A titled disclosure section. github's PullDetail is eight of these in a column, each hand-written
// with its own localStorage closure across three different mechanisms, two of them missing
// `aria-expanded`. See docs/ui-design.md § How the primitives are built (CollapsibleSection) for
// why it uses native `<details>` and has no accordion mode.

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

export function CollapsibleSection(props: {
  label: JSX.Element
  count?: number
  /** Rendered in the summary row and click-isolated from the toggle: a CopyButton in a fold's header
   *  must not open the fold. */
  actions?: JSX.Element
  level?: 'pane' | 'group' | 'sub'
  persistKey?: string
  /** Uncontrolled default, or a controlled override when `onToggle` is supplied. */
  open?: boolean
  onToggle?: (open: boolean) => void
  class?: string
  children: JSX.Element
}) {
  const [local, setLocal] = createSignal(readOpen(props.persistKey, props.open ?? false))
  const open = () => (props.onToggle ? props.open ?? false : local())

  return (
    <details
      class={cx('ui-fold', props.class)}
      open={open()}
      onToggle={(event) => {
        const next = event.currentTarget.open
        if (next === open()) return
        setLocal(next)
        writeOpen(props.persistKey, next)
        props.onToggle?.(next)
      }}
    >
      {/* The shared `.section-header` class, not a parallel one — SectionHeader emits it too, so a
          pack styles both with one selector. */}
      <summary class="section-header ui-fold-summary" data-level={props.level ?? 'group'}>
        <span class="ui-fold-marker" aria-hidden="true" />
        <span class="ui-section-header-label">{props.label}</span>
        <Show when={props.count != null}><span class="ui-section-header-count">{props.count}</span></Show>
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
