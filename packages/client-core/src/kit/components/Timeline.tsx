import { createEffect, on, onCleanup, type JSX } from 'solid-js'
import { createDomCollection } from '../../keys/collection'
import { nextFollowing } from '../lib/followScroll'

/* Timeline: a sequence of turns. The agents transcript and github's PR conversation are the same
   shape, and both drew it themselves.

   An ordered list, because the order is the meaning: a screen reader announces "3 of 40" and a
   terminal draws a rule between turns. Children are Cards.

   One stop with roving focus over the turns that are interactive, so a long transcript is walkable
   without tabbing through every control inside every card (../keys/collection.ts).

   Deliberately not virtualised, and the guardrail is the kit's rather than a pane's: the virtualizer
   the agents transcript used to run called `measure()` on every new event, which clears the item size
   cache, so every row fell back to the estimate, the canvas jumped, and the rows re-measured — on
   every event. It also rebuilt its rows from `getVirtualItems()`, which returns fresh objects on each
   scroll, replacing the DOM under any selection. If a transcript ever feels slow to open, render only
   the last N behind a "show earlier" control: a fixed window has no measurement feedback loop.

   At 80×24: the cards in sequence, a dim rule between turns. */

/* Where each followed timeline was left, by `viewKey`, for the life of the window.
   Only a place the reader chose is held: a timeline sitting at the newest turn has no entry, because
   the bottom moves as the list grows and replaying an offset would land short of it.

   Bounded, and by insertion order, because `ui/` may not import the scope-eviction store that would
   otherwise clear it. Fifty transcripts of scroll offsets is nothing; an unbounded map is a leak. */
const PLACES = 50
const places = new Map<string, number>()
const rememberPlace = (key: string, top: number): void => {
  places.delete(key)
  places.set(key, top)
  if (places.size > PLACES) places.delete(places.keys().next().value as string)
}

export function Timeline(props: {
  ariaLabel?: string
  /**
   * Own the scroll: stay on the newest turn as turns arrive, until the reader scrolls away from it,
   * and pick it up again when they scroll back.
   *
   * The kit's, not the caller's, because the scroller is the kit's the moment this is set. Without it
   * a timeline is a plain run of cards and whatever region it sits in does the scrolling.
   */
  follow?: boolean
  /** Which list this is, for the place the reader was left at. A timeline that swaps its contents —
   *  one session's stream for another's — is a different list and wants a different key. */
  viewKey?: string
  children: JSX.Element
}) {
  const collection = createDomCollection({ selector: '.ui-timeline-turn > .ui-card[data-interactive]' })
  const list = (
    <ol class="ui-timeline" aria-label={props.ariaLabel} {...collection.containerProps}>
      {props.children}
    </ol>
  ) as HTMLOListElement

  if (!props.follow) return list

  let scroller: HTMLDivElement | undefined
  const viewKey = () => props.viewKey ?? ''
  // Everything below is driven by the list resizing rather than by the data changing: a streamed
  // message keeps growing after the event that carried it, and code highlighting settles a frame or
  // two later again, so any write timed off the data lands short of a bottom that has since moved.
  let following = true
  let target: number | null = null
  let applied = -1
  // Armed by the reader's own input and spent on the next scroll event, which is how a decision to
  // scroll up is told apart from the browser clamping scrollTop under a shrinking list. Momentum
  // keeps delivering scroll events long after the gesture, but following is already off by then.
  let userDriven = false
  const nearBottom = (element: HTMLElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight < 96
  const pin = () => {
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
    applied = scroller.scrollTop
    places.delete(viewKey())
  }
  const applyTarget = () => {
    if (!scroller || target === null) return
    scroller.scrollTop = target
    applied = scroller.scrollTop
    // Highlighting resolves after mount and keeps growing the list, so the browser clamps an early
    // write. Re-apply until it sticks, driven by the list's own resizes.
    if (scroller.scrollTop < target - 1) return
    target = null
    following = nearBottom(scroller)
  }
  const noteScroll = () => {
    if (!scroller) return
    // Our own writes echo back as scroll events, by which time the list has usually grown again, so
    // the write just made would measure as "scrolled up". Skip them.
    if (scroller.scrollTop === applied) return
    target = null
    following = nextFollowing({ following, nearBottom: nearBottom(scroller), userDriven })
    userDriven = false
    if (following) places.delete(viewKey())
    else rememberPlace(viewKey(), scroller.scrollTop)
  }
  const noteInput = () => {
    userDriven = true
  }
  // The list grows for two reasons and the response differs: while restoring we chase the saved
  // offset, otherwise we sit on the bottom. The scroller is observed too, because something appearing
  // above it shortens the viewport without touching the list.
  const growth = new ResizeObserver(() => {
    if (target !== null) applyTarget()
    else if (following) pin()
  })
  growth.observe(list)
  onCleanup(() => growth.disconnect())
  // A memo as the dep, not an inline getter: `on()` runs its callback on every notification without
  // comparing the input, so a getter reading a record keyed by every session would reset the place
  // whenever any other session moved.
  createEffect(on(viewKey, (key) => {
    target = places.get(key) ?? null
    following = target === null
    // The click that changed the view armed this on the way out of the old one. Left armed, it is
    // spent on the first scroll event the new view produces, and a shorter list clamps scrollTop the
    // moment it renders, so that event would read as "the reader scrolled up". Whose input it was
    // does not survive the view it was made in.
    userDriven = false
    if (target === null) pin()
    else applyTarget()
  }))

  return (
    <div
      class="ui-timeline-scroll"
      ref={(element) => {
        scroller = element
        growth.observe(element)
      }}
      onScroll={noteScroll}
      onWheel={noteInput}
      onTouchMove={noteInput}
      onPointerDown={noteInput}
      onKeyDown={noteInput}
    >
      {list}
    </div>
  )
}

/** One turn. Wraps its child in the list item the timeline needs, so a caller composes Cards
 *  rather than remembering to write an `<li>`. */
Timeline.Turn = (props: { children: JSX.Element }) => <li class="ui-timeline-turn">{props.children}</li>
