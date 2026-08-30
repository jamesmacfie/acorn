import type { JSX } from 'solid-js'
import { createDomCollection } from '../keys/collection'

/* ChipRow: a wrapping strip of Chips. docker, linear, rollbar and the agents composer each wrote
   the same flex row for it.

   One stop with roving focus inside, over whichever chips are interactive: a chip is a stop only
   when it has an `onPress` or an `onRemove`, so the collection reads the buttons out of the DOM
   rather than being told (../keys/collection.ts).

   At 80×24: the chips on one line, wrapping. */
export function ChipRow(props: { ariaLabel?: string; children: JSX.Element }) {
  const collection = createDomCollection({ selector: 'button.ui-chip, .ui-chip-remove', orientation: 'horizontal' })
  return (
    <div
      class="ui-chiprow"
      role={props.ariaLabel ? 'group' : undefined}
      aria-label={props.ariaLabel}
      {...collection.containerProps}
    >
      {props.children}
    </div>
  )
}
