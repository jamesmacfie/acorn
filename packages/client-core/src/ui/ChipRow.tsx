import type { JSX } from 'solid-js'

/* ChipRow: a wrapping strip of Chips. docker, linear, rollbar and the agents composer each wrote
   the same flex row for it.

   At 80×24: the chips on one line, wrapping. */
export function ChipRow(props: { ariaLabel?: string; children: JSX.Element }) {
  return <div class="ui-chiprow" role={props.ariaLabel ? 'group' : undefined} aria-label={props.ariaLabel}>{props.children}</div>
}
