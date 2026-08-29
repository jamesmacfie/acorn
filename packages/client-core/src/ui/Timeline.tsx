import type { JSX } from 'solid-js'
import { createDomCollection } from '../keys/collection'

/* Timeline: a sequence of turns. The agents transcript and github's PR conversation are the same
   shape, and both drew it themselves.

   An ordered list, because the order is the meaning: a screen reader announces "3 of 40" and a
   terminal draws a rule between turns. Children are Cards.

   One stop with roving focus over the turns that are interactive, so a long transcript is walkable
   without tabbing through every control inside every card (../keys/collection.ts).

   At 80×24: the cards in sequence, a dim rule between turns. */
export function Timeline(props: { ariaLabel?: string; children: JSX.Element }) {
  const collection = createDomCollection({ selector: '.ui-timeline-turn > .ui-card[data-interactive]' })
  return (
    <ol class="ui-timeline list-reset" aria-label={props.ariaLabel} {...collection.containerProps}>
      {props.children}
    </ol>
  )
}

/** One turn. Wraps its child in the list item the timeline needs, so a caller composes Cards
 *  rather than remembering to write an `<li>`. */
Timeline.Turn = (props: { children: JSX.Element }) => <li class="ui-timeline-turn">{props.children}</li>
