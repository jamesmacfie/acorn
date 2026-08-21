import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createAnchoredPopover } from './anchor'

// Searchable popover picker: a button showing the current value opens a filter input + scrollable
// list. Presentational chrome only; the parent supplies results(query) so it owns filtering and
// ordering (pinned-first projects, substring branches, and so on). Shared by project pickers and
// the create-PR branch selectors so they look and behave identically. Esc / outside-click close it.
//
// Anchoring, dismissal and reflow come from ui/anchor.ts; see docs/ui-design.md § Menus and
// right-click for why (this file was the extraction's starting point) and for the portal/fixed
// positioning it relies on. Picker keeps only the filter/list semantics.
export default function Picker<T>(props: {
  label: string | JSX.Element // JSX so a picker can show its current value as an icon, not just text
  ariaLabel?: string
  placeholder: string
  emptyText: string
  results: (query: string) => T[]
  rowLabel: (item: T) => string
  rowDescription?: (item: T) => string | undefined
  isActive: (item: T) => boolean
  isDisabled?: (item: T) => boolean
  onSelect: (item: T) => void
  leading?: (item: T) => JSX.Element // optional per-row leading control (e.g. pin)
  tools?: JSX.Element // optional extra toolbar control beside the filter (e.g. refresh)
  status?: JSX.Element // optional status line under the toolbar (e.g. refresh failed)
  buttonClass?: string
  disabled?: boolean // greys the button and blocks opening (e.g. repo is fixed in a task view)
  keepOpen?: boolean // stay open after a pick, so the same list can drive a multi-select (isActive marks the chosen ones)
  placement?: 'top' | 'bottom'
}) {
  const [filter, setFilter] = createSignal('')
  let rootRef: HTMLDivElement | undefined
  let inputRef: HTMLInputElement | undefined

  const items = createMemo(() => props.results(filter()))

  // min 300px so the list stays readable when the button is narrow (e.g. "base").
  const popover = createAnchoredPopover({
    anchor: () => rootRef,
    placement: () => (props.placement === 'top' ? 'top-start' : 'bottom-start'),
    minWidth: 300,
    disabled: () => !!props.disabled,
    onDismiss: () => setFilter(''),
  })
  const open = popover.open

  const close = () => {
    popover.close()
    setFilter('')
  }
  const toggle = () => {
    popover.toggle()
    if (open()) queueMicrotask(() => inputRef?.focus())
  }
  const choose = (item: T) => {
    if (props.isDisabled?.(item)) return
    props.onSelect(item)
    if (!props.keepOpen) close()
  }

  return (
    <div class="repo-picker" ref={rootRef}>
      <button
        type="button"
        class={props.buttonClass ?? 'repo-picker-button'}
        aria-label={props.ariaLabel}
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
            ref={(el) => popover.setSurface(el)}
            class="repo-picker-popover repo-picker-popover-fixed"
            role="listbox"
            style={popover.surfaceStyle()}
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
                    <li
                      class="repo-picker-row"
                      classList={{ active: props.isActive(item), disabled: props.isDisabled?.(item) }}
                    >
                      {props.leading?.(item)}
                      <button
                        type="button"
                        class="repo-picker-name"
                        disabled={props.isDisabled?.(item)}
                        onClick={() => choose(item)}
                      >
                        <span>{props.rowLabel(item)}</span>
                        <Show when={props.rowDescription?.(item)}>
                          {(description) => <small>{description()}</small>}
                        </Show>
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
