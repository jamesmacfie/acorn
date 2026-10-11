import type { JSX } from 'solid-js'

export type FilterBarProps = {
  ariaLabel: string
  children: JSX.Element
}

/** A padded sidebar row for an Input, Select, or Picker and optional filter actions.
 * Filtering state and handlers belong to the caller. */
export function FilterBar(props: FilterBarProps) {
  return (
    <div class="ui-filterbar" role="group" aria-label={props.ariaLabel}>
      {props.children}
    </div>
  )
}
