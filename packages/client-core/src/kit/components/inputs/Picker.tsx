import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createAnchoredPopover, type Placement } from '../../lib/controls/anchor'
import PickerRow from './PickerRow'
import { Button } from './Button'
import { ConfirmButton } from './ConfirmButton'
import Icon from '../content/Icon'
import { claimField, FieldProvider, NO_FIELD } from './controlAttrs'
import type { Size } from '../../tokens/tokens'

// Searchable popover picker: a button showing the current value opens a filter input + scrollable
// list. Presentational chrome only; the parent supplies results(query) so it owns filtering and
// ordering (pinned-first projects, substring branches, and so on). Shared by project pickers and
// the create-PR branch selectors so they look and behave identically. Esc / outside-click close it.
//
// Anchoring, dismissal and reflow come from ui/anchor.ts; see docs/ui-design/interaction.md § Menus and
// right-click for why (this file was the extraction's starting point) and for the portal/fixed
// positioning it relies on. Picker keeps only the filter/list semantics.
//
// Two ways to fill it, and which one a caller uses is decided by where the caller runs. `results` and
// its companions are callbacks: the caller owns filtering and ordering, which is what a pinned-first
// project list needs. `items` is the same list as data, filtered here by substring, and it is the only
// form a remote tree can use — a function does not cross a message port
// (docs/plugins/tree-contract.md § The tree contract). The data form is deliberately the poorer
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

export type PickerProps<T> = {
  label: string | JSX.Element // JSX so a picker can show its current value as an icon, not just text
  ariaLabel?: string
  placeholder: string
  emptyText: string
  /** The data form. Supplying it makes every callback below optional and unread. */
  items?: readonly PickerItem[]
  /** Picked, by id, in the data form. */
  onPick?: (id: string) => void
  /** Search text as it changes. Metadata-backed pickers use this to request another bounded option
   *  page; record previews must never hang off it. Callback props are compiled-client only. */
  onSearch?: (query: string) => void
  /** A removable row's control was pressed twice, by id. */
  onRemove?: (id: string) => void
  /** The remove control's name, such as "Remove query". It arms on the first press and asks
   *  "Remove query?". Defaults to "Remove". */
  removeLabel?: string
  results?: (query: string) => T[]
  rowLabel?: (item: T) => string
  rowDescription?: (item: T) => string | undefined
  isActive?: (item: T) => boolean
  isDisabled?: (item: T) => boolean
  onSelect?: (item: T) => void
  leading?: (item: T) => JSX.Element // optional per-row leading control (e.g. pin)
  tools?: JSX.Element // optional extra toolbar control beside the filter (e.g. refresh)
  status?: JSX.Element // optional status line under the toolbar (e.g. refresh failed)
  /** An action below the list, such as "Add project…". It receives `close` so pressing it can dismiss the picker. */
  footer?: (close: () => void) => JSX.Element
  /** The trigger's size, as any Button's. A picker in a bar of `sm` buttons takes `sm` too, or it
   *  stands 6px taller than everything beside it. */
  size?: Extract<Size, 'sm' | 'md'>
  disabled?: boolean // greys the button and blocks opening (e.g. repo is fixed in a task view)
  keepOpen?: boolean // stay open after a pick, so the same list can drive a multi-select (isActive marks the chosen ones)
  placement?: Placement // 'bottom-end' for a trigger at the right edge, so the list opens leftward
}

export default function Picker<T>(props: PickerProps<T>) {
  const [filter, setFilter] = createSignal('')
  // The trigger takes the caption of the field or setting row it sits in, as a select does.
  const field = claimField()
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
      {/* The kit's own Button, not a second one styled to look like it: height, radius, hover,
          focus ring and the disabled state all came out slightly different, and a picker beside a
          button stood 6px taller than it wherever the two met. */}
      <Button
        label={props.ariaLabel}
        id={field?.id}
        describedBy={field?.describedBy()}
        size={props.size}
        opens="listbox"
        expanded={open()}
        disabled={props.disabled}
        onPress={toggle}
      >
        <span class="repo-picker-label">{props.label}</span>
        <span class="repo-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </Button>
      <Show when={open()}>
        {/* A control a caller puts in `tools` is not the one the caption names. */}
        <FieldProvider value={NO_FIELD}>
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
                onInput={(e) => {
                  setFilter(e.currentTarget.value)
                  props.onSearch?.(e.currentTarget.value)
                }}
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
                        ? (
                          <ConfirmButton
                            variant="bare"
                            size="xs"
                            iconOnly
                            label={props.removeLabel ?? 'Remove'}
                            tip={props.removeLabel ?? 'Remove'}
                            confirmLabel={`${props.removeLabel ?? 'Remove'}?`}
                            onConfirm={() => props.onRemove?.(row.id)}
                          >
                            <Icon name="x" />
                          </ConfirmButton>
                        )
                        : props.leading?.((props.results?.(filter()) ?? [])[index()] as T)}
                      onSelect={() => choose(row)}
                    />
                  )}
                </For>
              </ul>
            </Show>
            <Show when={props.footer}>
              {(footer) => <div class="repo-picker-footer">{footer()(close)}</div>}
            </Show>
          </div>
        </Portal>
        </FieldProvider>
      </Show>
    </div>
  )
}
