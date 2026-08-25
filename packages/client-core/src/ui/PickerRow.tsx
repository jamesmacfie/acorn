import { Show, type JSX } from 'solid-js'

// One row of a filtered list: a name over its description, with the description free to be a
// sentence. Extracted from Picker so a list that is not driven by Picker's trigger button can still
// be the same row — the agent composer's mention dropdown opens from a sigil typed in a textarea,
// not from a button, and had drifted into a cramped single line of its own.
//
// The <li> is the component's, the <ul class="repo-picker-list"> is the caller's, because the two
// callers differ on what wraps the list.
export default function PickerRow(props: {
  label: string
  description?: string
  /** The current value in a Picker, the keyboard cursor in a type-ahead list. Same mark either way. */
  active?: boolean
  disabled?: boolean
  leading?: JSX.Element
  /** `option` for a list the keyboard walks, so `active` also reports as `aria-selected`. */
  role?: 'option'
  onSelect: () => void
  /** A list driven by a text field moves its cursor on hover, and must not steal that field's focus. */
  onHover?: () => void
  onMouseDown?: (event: MouseEvent) => void
}) {
  return (
    <li
      class="repo-picker-row"
      classList={{ active: props.active, disabled: props.disabled }}
      role={props.role}
      aria-selected={props.role === 'option' ? props.active : undefined}
      onMouseEnter={() => props.onHover?.()}
    >
      {props.leading}
      <button
        type="button"
        class="repo-picker-name"
        disabled={props.disabled}
        onMouseDown={(event) => props.onMouseDown?.(event)}
        onClick={() => props.onSelect()}
      >
        <span>{props.label}</span>
        <Show when={props.description}>
          {(description) => <small>{description()}</small>}
        </Show>
      </button>
    </li>
  )
}
