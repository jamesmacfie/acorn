import { createEffect, on, onCleanup, onMount, type JSX } from 'solid-js'
import { createDomCollection } from '../../keys/collection'
import { LIVE, placeAfterScroll, resolveAnchor, samePlace, type ReadingPlace } from '../../lib/readingPlace'
import { reportScrollPlace } from '../../lib/scrollPlace'

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

/** The two jumps a caller can drive from outside — a "go to top"/"go to bottom" pair above the
 *  composer, say. Handed out through `controls` because the scroll is the timeline's own, so the
 *  jumps have to move the reading place as well as the scrollTop or a stream would pull the view
 *  straight back down. Only meaningful on a followed timeline. */
export type TimelineControls = {
  /** Jump to the oldest turn and stop following, so new turns no longer pull the view down. */
  toTop: () => void
  /** Jump to the newest turn and follow it again. */
  toBottom: () => void
}

/** How many frames one settling burst may spend putting the anchor back. The resizes that follow
 *  re-arm it, so this bounds a burst rather than the whole restore: a transcript whose highlighting
 *  lands three seconds late gets another go when it does, without a frame loop running in between. */
const CORRECTIONS = 24

/** How long the reader's input stays the explanation for a move.
 *
 *  Input arms a gesture and the next scroll event spends it, which is right when the input scrolls.
 *  Plenty of it does not: a click to put the caret in a card, a drag to select a line, a key the list
 *  ignores. That arm then sat there, and whatever moved the view next — a clamp, a card re-rendering
 *  shorter, the browser putting something on screen — was written down as the place the reader chose.
 *
 *  A scroll caused by input arrives within a frame or two. A second is long enough to cover a slow one
 *  and short enough that a click the reader has forgotten about cannot claim the next move. */
const GESTURE_MS = 1000

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
  /**
   * Where the reader is. Supplying it hands the place to the caller: this component measures and
   * moves its own scroller, and the caller remembers, so a place outlives the mount that made it.
   *
   * Supply both or neither. Without them a followed timeline still holds the reader where they scrolled
   * to for as long as it is mounted, and forgets it when it goes, which is all a caller with nowhere to
   * keep a place can be given.
   *
   * Hold it in something that does not notify, a plain map rather than a signal. This is read through
   * an effect, so a store that notified on every write would restart the restore each time any list
   * moved.
   */
  place?: () => ReadingPlace
  /** The reader's place changed, and only ever because the reader moved. Named `onChange` because a
   *  callback prop only crosses to a sandboxed host under one of the kit's eleven semantic events. */
  onChange?: (place: ReadingPlace) => void
  /** Handed the scroll jumps once the scroller exists, for a control that lives outside this element.
   *  Only called on a followed timeline; a plain run of cards has no scroll of its own to drive. */
  controls?: (api: TimelineControls) => void
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
  // The reader's place, as this component last understood it. `props.place` is the truth; this is what
  // the corrections below are aimed at.
  let place: ReadingPlace = LIVE
  let opened = false
  // Bumped when the caller hands over a different place, so a frame the outgoing list scheduled cannot
  // move the incoming one.
  let generation = 0
  let frame = 0
  let corrections = 0
  // Set while this component is the one writing scrollTop, and cleared a frame later. A scroll event
  // arrives after the write that caused it, and telling ours from the reader's by comparing positions
  // does not survive the fractional device pixels a WebView reports.
  let applying = false
  let releasing = false
  // Armed by the reader's own input and spent on the next scroll event, which is how a decision to
  // scroll up is told apart from the browser clamping scrollTop under a shrinking list. Momentum
  // keeps delivering scroll events long after the gesture, but the place is already captured by then.
  let userDriven = false
  // When the reader last touched this, which is a different question from `userDriven`: that says an
  // input has not been spent yet, this says how long ago it was. A scrollbar drag and a flick of
  // momentum both deliver many scroll events for one gesture, and `userDriven` is spent on the first of
  // them, so the rest would read as moves nobody made. Nothing scrolls a second after the reader
  // stopped touching it (`GESTURE_MS`).
  let lastInput = 0
  // Where the view was the last time anything here looked, so a report can say what the move was from
  // as well as to.
  let at = 0

  /** This timeline's own turns, in order. `:scope >` because a timeline drawn inside a card of another
   *  one must not have its turns harvested by the outer scroller. */
  const turns = (): HTMLElement[] =>
    [...list.querySelectorAll<HTMLElement>(':scope > .ui-timeline-turn[data-turn]')]

  /**
   * The turn the viewport starts in, and how far into it.
   *
   * The reader's eye is on the first turn whose bottom edge is still below the top of the viewport.
   * Measured from the scroller's own top edge rather than from `offsetTop`, for two reasons: an
   * `offsetParent` inside a card would silently change what `offsetTop` means, and every constant in
   * the expression — the scroller's border, its padding, anything sticky above the list — cancels,
   * because saving and restoring evaluate the same difference. What is stored is not a coordinate to
   * replay. It is the input to a correction that is measured again every time it is applied, which is
   * why content growing above the reader cannot invalidate it.
   *
   * Ceiling: a linear scan, one rect read per turn. A transcript is a few hundred cards and the reads
   * share one layout, so this is microseconds; walk out from the last known index if a list ever holds
   * thousands.
   */
  const measure = (): ReadingPlace | null => {
    if (!scroller) return null
    const top = scroller.getBoundingClientRect().top
    const rows = turns()
    const index = rows.findIndex((row) => row.getBoundingClientRect().bottom > top)
    const row = rows[index]
    return row ? { at: 'turn', key: row.dataset.turn ?? '', index, offset: top - row.getBoundingClientRect().top } : null
  }

  const write = (top: number) => {
    if (!scroller) return
    applying = true
    scroller.scrollTop = top
    at = scroller.scrollTop
    // One release for however many writes are in flight. Scheduling one each would let the first frame
    // clear the guard while a later write's scroll event is still on its way, and that event would then
    // read as the reader moving.
    if (releasing) return
    releasing = true
    requestAnimationFrame(() => { applying = false; releasing = false })
  }
  const pin = () => { if (scroller) write(scroller.scrollHeight) }

  /** Tell the caller where the reader is, when it has changed. */
  const adopt = (next: ReadingPlace) => {
    if (samePlace(next, place)) return
    place = next
    props.onChange?.(next)
  }

  const schedule = () => {
    if (frame || !scroller) return
    const era = generation
    frame = requestAnimationFrame(() => {
      frame = 0
      if (era === generation) correct()
    })
  }

  /**
   * Put the anchor turn back where the reader left it, and keep asking until it is there or the list
   * refuses to move any further.
   *
   * "Is the turn where I asked for it" is a question that can be answered. The old code asked "did the
   * browser accept my pixel", which answers no for ever whenever the list is shorter than the number,
   * and that is what parked a reader at the top. "The list would not move" is the second way to be
   * done, for an anchor that cannot be brought any higher because it is the last turn of a short list;
   * the budget below would end that case anyway, a couple of dozen frames later.
   */
  const correct = () => {
    if (!scroller) return
    // Following: the reader's place is the foot, so putting them back is pinning them there. This used
    // to return, which left `noteScroll`'s undertaking that "the next frame puts them back" false for
    // the one reader who had asked to be held on the newest turn. The resizes a live list produces hid
    // it, right up until the agent stopped and there were none.
    if (place.at !== 'turn') { pin(); return }
    const rows = turns()
    // Nothing drawn yet. The resizes that follow re-arm this, so a list still arriving gets another go
    // without a frame budget of its own.
    if (!rows.length) return
    const found = resolveAnchor(place, rows.map((row) => row.dataset.turn ?? ''))
    if (!found) {
      report('took', scroller.scrollTop)
      adopt(LIVE)
      pin()
      return
    }
    const row = rows.find((candidate) => candidate.dataset.turn === found.key)
    if (!row) return
    // Clamped in case the turn came back shorter than the reader left it, which "collapse all" does.
    const want = Math.min(found.offset, Math.max(0, row.offsetHeight - 1))
    const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + want
    const before = scroller.scrollTop
    let settled = Math.abs(delta) <= 1
    if (!settled) {
      write(before + delta)
      // Asked and refused: this list cannot bring that turn any closer, so this is as near as the
      // reader can be put and there is nothing to gain by asking again.
      settled = scroller.scrollTop === before
    }
    if (!settled) {
      if (++corrections < CORRECTIONS) schedule()
      else corrections = 0
      return
    }
    corrections = 0
    // Settling does not redefine where the reader wants to be. It used to: it re-measured and adopted
    // whatever was under the viewport, so a settle that happened while the list was still short adopted
    // the top and wrote it to the caller's store, and every later visit opened there. The one thing
    // worth adopting is a substitute, because the turn the reader chose has left the list for good and
    // chasing its key would cost a correction on every resize from here on.
    if (found.key === place.key) return
    report('took', scroller.scrollTop)
    adopt({ at: 'turn', key: found.key, index: rows.indexOf(row), offset: found.offset })
  }

  const report = (cause: 'opened' | 'unasked' | 'took', to: number): void => {
    if (!scroller) return
    reportScrollPlace({
      anchor: place.at === 'live' ? 'live' : place.key,
      cause,
      from: at,
      to,
      height: scroller.scrollHeight,
      viewport: scroller.clientHeight,
      following: place.at === 'live',
    })
  }

  const noteScroll = () => {
    // Our own write, echoing back. Also the guard that stops a scroll arriving while this subtree is
    // torn down from being read as the reader moving: cleanup drops the scroller first.
    if (!scroller || applying) return
    // Armed, and recently enough to be about this move. Without the second half a click that scrolled
    // nothing stayed armed until something else moved the view, and that move was then adopted as the
    // reader's place and written to the caller's store, where it outlived the mount that invented it.
    const fresh = Date.now() - lastInput < GESTURE_MS
    const gesture = userDriven && fresh
    const top = scroller.scrollTop
    const geometry = { scrollTop: top, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight }
    // Pressed against the very bottom with nobody having scrolled: the list shrank and the browser
    // clamped scrollTop to the only offset left.
    const clamp = !gesture && top >= geometry.scrollHeight - geometry.clientHeight - 1
    // Not the reader, not one of our own writes, and not a clamp, and yet the view has moved up by more
    // than a screen. Said out loud, because nothing here can say what did it (../../lib/scrollPlace.ts).
    if (!fresh && !clamp && top < at - geometry.clientHeight) report('unasked', top)
    userDriven = false
    at = top
    adopt(placeAfterScroll({ place, gesture, geometry, anchor: measure }))
    // The reader moved after we did, so a correction in flight is now aimed at where they are. Anything
    // else moved them without asking, and the next frame puts them back.
    corrections = 0
    if (!gesture) schedule()
  }

  const noteInput = () => {
    userDriven = true
    lastInput = Date.now()
  }

  // Driven from outside, so they set the place by hand rather than inferring it from position: a jump
  // to the top must survive the next streamed event, which reading the position back would take as the
  // list growing under a reader who is still at the foot.
  const toTop = () => {
    const first = turns()[0]
    if (first) adopt({ at: 'turn', key: first.dataset.turn ?? '', index: 0, offset: 0 })
    write(0)
  }
  const toBottom = () => { adopt(LIVE); pin() }
  props.controls?.({ toTop, toBottom })

  // The list grows for two reasons and the response is the same rule either way: sit on the foot, or
  // put the anchor turn back under the reader. The scroller is observed too, because something
  // appearing above it shortens the viewport without touching the list.
  const growth = new ResizeObserver(() => {
    if (place.at === 'live') pin()
    else schedule()
  })
  growth.observe(list)

  /**
   * Taken off the page and put back by something outside, which is a move like any other.
   *
   * A scroller that was detached comes back at the top, and the browser reports neither a scroll
   * event nor a resize for it, so every other signal in this file misses it: the reader opens a
   * transcript, watches it land on the newest turn, and then watches it jump to the first one.
   *
   * What produced it was the `Suspense` around every pane region (host/registries/panes/panes.ts):
   * a query in the region reading an empty cache suspended that boundary after the region had drawn,
   * and every child left the document for the length of the fetch. The solid-js patch closed that off
   * — a boundary that has drawn never swaps back to its fallback (patches/README.md) — and this stays
   * because re-parenting is not only that boundary's to do. It costs one observer on a parent whose
   * children are its bar, its body and its composer, and the answer is the correction the rest of
   * this file already runs.
   */
  const replaced = new MutationObserver(() => { if (scroller?.isConnected) schedule() })
  onMount(() => { if (scroller?.parentElement) replaced.observe(scroller.parentElement, { childList: true }) })

  onCleanup(() => {
    growth.disconnect()
    replaced.disconnect()
    if (frame) cancelAnimationFrame(frame)
    scroller = undefined
  })

  // The caller handing over a place is what restarts a restore: a new mount, or the same component
  // swapping one session's stream for another's.
  //
  // An equal place is nothing to do, with one exception. Two live places are equal by value but they
  // are the foot of two different lists, and a caller only hands one over when the view it belongs to
  // has changed — it has no other reason to read its store again. Skipping that left a reader who was
  // following one session sitting at that session's offset, partway down a transcript they had never
  // seen, until some later resize happened to pin them.
  createEffect(on(() => props.place?.() ?? LIVE, (next) => {
    if (opened && next.at !== 'live' && samePlace(next, place)) return
    opened = true
    generation += 1
    corrections = 0
    // The click that changed the view armed this on the way out of the old one. Left armed, it is
    // spent on the first scroll event the new view produces. Whose input it was does not survive the
    // view it was made in.
    userDriven = false
    place = next
    if (next.at === 'live') pin()
    else correct()
    // A remount lands here and nowhere else: a fresh scroll element starts at zero and fires no scroll
    // event, so this is the only record that the reader was put somewhere by a list opening rather
    // than by anything they did.
    report('opened', scroller?.scrollTop ?? 0)
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
      // Focus counts as the reader's input, but only when it lands on a turn in this list: revealing a
      // card scrolls it into view and then focuses it, and focus is delivered before the scroll event,
      // so the scroll that follows is the reveal rather than a move to be undone. Focus arriving
      // anywhere else inside the scroller is not a scroll, and treating it as one let a rebuilt pane
      // hand its own focus restoration to the next scroll event as if the reader had made it.
      onFocusIn={(event) => {
        if ((event.target as HTMLElement | null)?.closest('.ui-timeline-turn')) noteInput()
      }}
    >
      {list}
    </div>
  )
}

/** One turn. Wraps its child in the list item the timeline needs, so a caller composes Cards
 *  rather than remembering to write an `<li>`.
 *
 *  `key` is what a followed timeline puts the reader back on. Without it the list can still be drawn
 *  and followed, but it has no places to remember, so give one to every turn or to none. */
Timeline.Turn = (props: { key?: string; children: JSX.Element }) => (
  <li class="ui-timeline-turn" data-turn={props.key}>{props.children}</li>
)
