import { Show, type JSX } from 'solid-js'

// One row of a filtered list: a name over its description, with the description free to be a
// sentence. Its own component so a list that is not driven by Picker's trigger button draws the same
// row: the agent composer's mention dropdown opens from a sigil typed in a textarea, not a button.
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
  /** A control after the name, at the row's right edge, such as a second action on the same item. */
  trailing?: JSX.Element
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
        <Show when={props.description}>{(description) => <small>{description()}</small>}</Show>
      </button>
      {props.trailing}
    </li>
  )
}
