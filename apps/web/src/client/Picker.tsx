import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'

// Searchable popover picker: a button showing the current value opens a filter input + scrollable
// list. Presentational chrome only — the parent supplies results(query) so it owns filtering and
// ordering (pinned-first repos, substring branches, …). Shared by RepoPicker and the create-PR
// branch selectors so they look and behave identically. Esc / outside-click close it.
//
// The popover is rendered through a Portal and positioned `fixed` to the button's rect: panes set
// `overflow`, and an absolutely-positioned child can't escape an overflow-clipped ancestor — it'd
// be clipped at the pane edge instead of overlaying the next column. The Portal lifts it out of
// every overflow/stacking context so it floats above the rest of the app.
export default function Picker<T>(props: {
  label: string
  placeholder: string
  emptyText: string
  results: (query: string) => T[]
  rowLabel: (item: T) => string
  isActive: (item: T) => boolean
  onSelect: (item: T) => void
  leading?: (item: T) => JSX.Element // optional per-row leading control (e.g. pin)
  tools?: JSX.Element // optional extra toolbar control beside the filter (e.g. refresh)
  status?: JSX.Element // optional status line under the toolbar (e.g. refresh failed)
  buttonClass?: string
  disabled?: boolean // greys the button and blocks opening (e.g. repo is fixed in a task view)
}) {
  const [open, setOpen] = createSignal(false)
  const [filter, setFilter] = createSignal('')
  const [pos, setPos] = createSignal({ top: 0, left: 0, width: 0 })
  let rootRef: HTMLDivElement | undefined
  let popoverRef: HTMLDivElement | undefined
  let inputRef: HTMLInputElement | undefined

  const items = createMemo(() => props.results(filter()))

  // Anchor the fixed popover under the button. min 300px so it stays readable when the button is
  // narrow (e.g. "base"); recomputed on open and while open as the page scrolls/resizes.
  const reposition = () => {
    const r = rootRef?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 300) })
  }

  const close = () => {
    setOpen(false)
    setFilter('')
  }
  const toggle = () => {
    if (props.disabled) return
    if (open()) close()
    else {
      reposition()
      setOpen(true)
      queueMicrotask(() => inputRef?.focus())
    }
  }
  const choose = (item: T) => {
    props.onSelect(item)
    close()
  }

  // Outside-click must account for the portalled popover living outside rootRef.
  const onDocPointer = (e: PointerEvent) => {
    if (!open()) return
    const t = e.target as Node
    if (!rootRef?.contains(t) && !popoverRef?.contains(t)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open()) {
      e.preventDefault()
      close()
    }
  }
  const onReflow = () => {
    if (open()) reposition()
  }
  onMount(() => {
    document.addEventListener('pointerdown', onDocPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true) // capture: catch scrolls in inner panes too
  })
  onCleanup(() => {
    document.removeEventListener('pointerdown', onDocPointer)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onReflow)
    window.removeEventListener('scroll', onReflow, true)
  })

  return (
    <div class="repo-picker" ref={rootRef}>
      <button
        type="button"
        class={props.buttonClass ?? 'repo-picker-button'}
        aria-haspopup="listbox"
        aria-expanded={open()}
        disabled={props.disabled}
        onClick={toggle}
      >
        <span class="repo-picker-label">{props.label}</span>
        <span class="repo-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={popoverRef}
            class="repo-picker-popover repo-picker-popover-fixed"
            role="listbox"
            style={{ top: `${pos().top}px`, left: `${pos().left}px`, width: `${pos().width}px` }}
          >
            <div class="repo-picker-tools">
              <input
                ref={inputRef}
                class="repo-picker-filter"
                placeholder={props.placeholder}
                value={filter()}
                onInput={(e) => setFilter(e.currentTarget.value)}
              />
              {props.tools}
            </div>
            {props.status}
            <Show when={items().length} fallback={<p class="repo-picker-empty">{props.emptyText}</p>}>
              <ul class="repo-picker-list">
                <For each={items()}>
                  {(item) => (
                    <li class="repo-picker-row" classList={{ active: props.isActive(item) }}>
                      {props.leading?.(item)}
                      <button type="button" class="repo-picker-name" onClick={() => choose(item)}>
                        {props.rowLabel(item)}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  )
}
