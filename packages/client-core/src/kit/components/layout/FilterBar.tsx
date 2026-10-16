import { Show, type JSX } from 'solid-js'
import { Spinner } from '../content/Spinner'

export type FilterBarProps = {
  ariaLabel: string
  /** Draws a spinner over the end of the bar's last control, so a search that comes and goes never
   *  moves the rows under the bar. */
  busy?: boolean
  children: JSX.Element
}

/** A padded sidebar row for an Input, Select, or Picker and optional filter actions.
 * Filtering state and handlers belong to the caller. */
export function FilterBar(props: FilterBarProps) {
  return (
    <div class="ui-filterbar" role="group" aria-label={props.ariaLabel} data-busy={props.busy ? '' : undefined}>
      {props.children}
      <Show when={props.busy}>
        <Spinner label="Searching" />
      </Show>
    </div>
  )
}
