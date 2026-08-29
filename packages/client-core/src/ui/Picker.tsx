import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createAnchoredPopover, type Placement } from './anchor'
import PickerRow from './PickerRow'
import { Button } from './primitives'

// Searchable popover picker: a button showing the current value opens a filter input + scrollable
// list. Presentational chrome only; the parent supplies results(query) so it owns filtering and
// ordering (pinned-first projects, substring branches, and so on). Shared by project pickers and
// the create-PR branch selectors so they look and behave identically. Esc / outside-click close it.
//
// Anchoring, dismissal and reflow come from ui/anchor.ts; see docs/ui-design.md § Menus and
// right-click for why (this file was the extraction's starting point) and for the portal/fixed
// positioning it relies on. Picker keeps only the filter/list semantics.
//
// Two ways to fill it, and which one a caller uses is decided by where the caller runs. `results` and
// its companions are callbacks: the caller owns filtering and ordering, which is what a pinned-first
// project list needs. `items` is the same list as data, filtered here by substring, and it is the only
// form a remote tree can use — a function does not cross a message port
// (docs/future/layout/06-remote-tree.md § The wire format). The data form is deliberately the poorer
// one: substring over the label and the note, no ordering of the caller's own.

/** One row, when the list is data rather than a callback. */
export type PickerItem = {
  id: string
  label: string
  /** A second line, and the other half of what typing matches against. */
  note?: string
  active?: boolean
  disabled?: boolean
  /** Draws the row's own remove control, which reports through `onRemove`. */
  removable?: boolean
}

export default function Picker<T>(props: {
  label: string | JSX.Element // JSX so a picker can show its current value as an icon, not just text
  ariaLabel?: string
  placeholder: string
  emptyText: string
  /** The data form. Supplying it makes every callback below optional and unread. */
  items?: readonly PickerItem[]
  /** Picked, by id, in the data form. */
  onPick?: (id: string) => void
  /** A removable row's control was pressed, by id. */
  onRemove?: (id: string) => void
  results?: (query: string) => T[]
  rowLabel?: (item: T) => string
  rowDescription?: (item: T) => string | undefined
  isActive?: (item: T) => boolean
  isDisabled?: (item: T) => boolean
  onSelect?: (item: T) => void
  leading?: (item: T) => JSX.Element // optional per-row leading control (e.g. pin)
  tools?: JSX.Element // optional extra toolbar control beside the filter (e.g. refresh)
  status?: JSX.Element // optional status line under the toolbar (e.g. refresh failed)
  buttonClass?: string
  disabled?: boolean // greys the button and blocks opening (e.g. repo is fixed in a task view)
  keepOpen?: boolean // stay open after a pick, so the same list can drive a multi-select (isActive marks the chosen ones)
  placement?: Placement // 'bottom-end' for a trigger at the right edge, so the list opens leftward
}) {
  const [filter, setFilter] = createSignal('')
  let rootRef: HTMLDivElement | undefined
  let inputRef: HTMLInputElement | undefined

  const rows = createMemo<PickerItem[]>(() => {
    // The data form, filtered here. One `includes` over the label and the note, which is the whole of
    // what this form promises.
    if (props.items) {
      const query = filter().trim().toLowerCase()
      if (!query) return [...props.items]
      return props.items.filter((item) => `${item.label} ${item.note ?? ''}`.toLowerCase().includes(query))
    }
    // The callback form, projected onto the same row shape so there is one list below rather than two.
    // The index is the id because the caller's items are opaque here; `choose` maps it back.
    return (props.results?.(filter()) ?? []).map((item, index) => ({
      id: String(index),
      label: props.rowLabel?.(item) ?? '',
      ...(props.rowDescription?.(item) !== undefined ? { note: props.rowDescription(item) } : {}),
      active: props.isActive?.(item) ?? false,
      disabled: props.isDisabled?.(item) ?? false,
    }))
  })

  // min 300px so the list stays readable when the button is narrow (e.g. "base").
  const popover = createAnchoredPopover({
    anchor: () => rootRef,
    placement: () => props.placement ?? 'bottom-start',
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
  const choose = (row: PickerItem) => {
    if (row.disabled) return
    if (props.items) props.onPick?.(row.id)
    else {
      const item = (props.results?.(filter()) ?? [])[Number(row.id)]
      if (item === undefined) return
      props.onSelect?.(item)
    }
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
            <Show when={rows().length} fallback={<p class="repo-picker-empty">{props.emptyText}</p>}>
              <ul class="repo-picker-list">
                <For each={rows()}>
                  {(row, index) => (
                    <PickerRow
                      label={row.label}
                      description={row.note}
                      active={row.active}
                      disabled={row.disabled}
                      leading={row.removable
                        ? <Button variant="bare" size="sm" tone="danger" label="Remove" onPress={() => props.onRemove?.(row.id)}>✕</Button>
                        : props.leading?.((props.results?.(filter()) ?? [])[index()] as T)}
                      onSelect={() => choose(row)}
                    />
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
