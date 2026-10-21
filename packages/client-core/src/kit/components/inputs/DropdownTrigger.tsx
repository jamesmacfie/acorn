import type { JSX } from 'solid-js'
import { buttonAttrs, type ButtonProps } from './Button'

/** The trigger every dropdown draws, a `Select` and a `Picker` alike: the kit's button with the
 *  choice or the name on it, then a chevron. One component, so the two can't drift apart in size,
 *  type, or look on any form factor. */
export function DropdownTrigger(props: {
  /** What the button shows: a select's current choice, a picker's name. */
  children: JSX.Element
  /** The accessible name, where no `Field` gives it one. */
  label?: string
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  /** `full` fills a form row, as a text input beside it does. */
  width?: 'full' | 'auto' | 'narrow'
  invalid?: boolean
  /** Marks a `Select`'s trigger with `ui-select`, the hook tests and pages find a select by. */
  select?: boolean
  id?: string
  describedBy?: string
  title?: string
  disabled?: boolean
  autofocus?: boolean
  expanded: boolean
  ref?: (element: HTMLButtonElement) => void
  onPress: () => void
  onKeyDown?: (event: KeyboardEvent) => void
}) {
  return (
    <button
      {...buttonAttrs({
        label: props.label,
        size: props.size,
        variant: props.variant,
        opens: 'listbox',
        expanded: props.expanded,
        id: props.id,
        describedBy: props.describedBy,
        title: props.title,
      })}
      class={props.select ? 'ui-btn ui-dropdown ui-select' : 'ui-btn ui-dropdown'}
      data-width={props.width}
      data-invalid={props.invalid ? '' : undefined}
      aria-invalid={props.invalid ? 'true' : undefined}
      type="button"
      ref={props.ref}
      autofocus={props.autofocus}
      disabled={props.disabled}
      onClick={() => props.onPress()}
      onKeyDown={(event) => props.onKeyDown?.(event)}
    >
      <span class="ui-dropdown-label">{props.children}</span>
      <span class="ui-dropdown-chevron" aria-hidden="true">
        ▾
      </span>
    </button>
  )
}
