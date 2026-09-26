import { createContext, createEffect, createSignal, on, onCleanup, onMount, Show, untrack, useContext, type Accessor, type JSX } from 'solid-js'
import { createDomCollection } from '../../keys/collection'
import { LIVE, placeAfterScroll, resolveAnchor, samePlace, type ReadingPlace } from '../../lib/readingPlace'
import { createScrollAuthor } from '../../lib/scrollAuthor'
import { reportScrollPlace } from '../../lib/scrollPlace'
import { registerSurfaceHealth } from '../../lib/surfaceHealth'
import { TIMELINE_PAGE } from '../../lib/timelineWindow'
import { Button } from '../primitives'

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
   scroll, replacing the DOM under any selection. A long list is instead drawn as its newest turns
   behind a "Show earlier" control (../../lib/timelineWindow.ts): a fixed window counts turns, measures
   none, and has no feedback loop. The caller decides which turns exist in the DOM; this component
   keeps the reader's place by identity while that changes.

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

/** How far from the viewport a deferred turn body is built: one scroller height either side, so a
 *  reader scrolling at an ordinary pace finds it drawn. */
const NEAR_MARGIN = '100% 0px'

/** What a timeline hands its turns: watch this element and say once when it comes near the viewport.
 *  Returns the stop. Absent outside a timeline, where a deferred body is simply built. */
const NearTurns = createContext<(element: Element, seen: () => void) => () => void>()

/** The element that scrolls this one, or null for the page. Read once, when the first deferred turn
 *  asks, because a timeline without `follow` scrolls in whatever region holds it. */
const scrollParent = (element: Element): Element | null => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
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
  /** How many turns the caller's list holds, drawn or not. Only the health reading uses it, and it is
   *  the difference between the turns that exist and the turns in the DOM; omit it and the two are
   *  reported as the same. */
  total?: number
  /**
   * How many older turns the caller holds and is not drawing (../../lib/timelineWindow.ts). Above
   * zero, a followed timeline draws a "Show earlier" control above its first turn, so hidden history
   * is always stated rather than left for a page find to miss.
   */
  hidden?: number
  /** The reader pressed "Show earlier". Draw more older turns; the reader stays on the turn they were
   *  looking at. */
  onShowEarlier?: () => void
  /**
   * Make a hidden turn present, for a reading place whose turn the window is not drawing. True when
   * the caller drew it; false when it is not in the list at all, which is the only case where the
   * reader is moved to another turn. Asked before any substitute, because a turn the window hides has
   * not gone. A plain function rather than a kit event, so it only works for a caller in this realm.
   */
  reveal?: (key: string) => boolean
  /**
   * Following the live end with at least twice a page of turns drawn, the timeline hands the oldest
   * back: called with the key of the oldest turn worth keeping, and the caller stops drawing the ones
   * before it. Never past a turn holding the reader's selection or focus.
   */
  onTrim?: (key: string) => void
  children: JSX.Element
}) {
  const collection = createDomCollection({ selector: '.ui-timeline-turn > .ui-card[data-interactive]' })
  // The scroller, when `follow` makes one. Declared here because the deferred-body observer below is
  // rooted on it.
  let scroller: HTMLDivElement | undefined

  // What this timeline says about itself (../../lib/surfaceHealth.ts). Registered before the early
  // return, so a plain run of cards counts too, and before every cleanup below, so the final reading
  // sees the observers disconnected and the frames cancelled. Observers count up when constructed and
  // down when disconnected, which is how a teardown check sees them go without waiting on the collector.
  const counts = {
    observers: 0, observed: 0, corrections: 0, failed: 0, substituted: 0, maxPixels: 0, drift: 0,
    expansions: 0, trims: 0, pinned: 0,
  }
  let scheduledFrames = () => 0
  let bodies = 0
  let list!: HTMLOListElement
  const health = registerSurfaceHealth('timeline', () => {
    const mounted = list.childElementCount
    // An opened disclosure has built its body, and a closed one that never opened has only its summary
    // (../layout/Fold.tsx). Counted when asked, like everything else here.
    let folds = 0
    for (const fold of list.querySelectorAll('.ui-fold')) if (fold.childElementCount > 1) folds += 1
    return {
      topology: { dynamicBlocks: props.total ?? mounted, ready: true },
      mounted: { dynamicBlocks: mounted, bodies: bodies + folds },
      work: { scheduledFrames: scheduledFrames() },
      measurement: { activeObservers: counts.observers, observedElements: counts.observed },
      correction: {
        count: counts.corrections, failed: counts.failed, substituted: counts.substituted,
        maxPixels: counts.maxPixels, maxAnchorDrift: counts.drift,
      },
      window: { hiddenEarlier: props.hidden ?? 0, expansions: counts.expansions, trims: counts.trims, pinned: counts.pinned },
    }
  })
  onCleanup(health.dispose)

  // Deferred turn bodies (`Timeline.Turn`'s function child), and the one observer that says when each
  // comes near. Made at mount, when the region that scrolls this list can be found, and only if a turn
  // asked; a list with none of them pays for nothing. Without an IntersectionObserver every body is
  // built at once, which is the right answer for a host that cannot say what is near.
  const waiting = new Map<Element, () => void>()
  let near: IntersectionObserver | undefined
  let mounted = false
  const observe = (element: Element) => {
    if (!near) {
      near = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const run = entry.isIntersecting ? waiting.get(entry.target) : undefined
          if (!run) continue
          waiting.delete(entry.target)
          near?.unobserve(entry.target)
          counts.observed -= 1
          run()
        }
      }, { root: props.follow ? scroller ?? null : scrollParent(list), rootMargin: NEAR_MARGIN })
      counts.observers += 1
    }
    near.observe(element)
    counts.observed += 1
  }
  const watchNear = (element: Element, seen: () => void) => {
    let built = false
    const build = () => {
      built = true
      bodies += 1
      seen()
    }
    if (typeof IntersectionObserver === 'undefined') build()
    else {
      waiting.set(element, build)
      if (mounted) observe(element)
    }
    return () => {
      if (built) bodies -= 1
      if (waiting.delete(element) && near) {
        near.unobserve(element)
        counts.observed -= 1
      }
    }
  }
  onMount(() => {
    mounted = true
    for (const element of waiting.keys()) observe(element)
  })
  onCleanup(() => {
    if (!near) return
    near.disconnect()
    near = undefined
    counts.observers -= 1
    counts.observed -= waiting.size
    waiting.clear()
  })

  list = (
    <ol class="ui-timeline" aria-label={props.ariaLabel} {...collection.containerProps}>
      <NearTurns.Provider value={watchNear}>{props.children}</NearTurns.Provider>
    </ol>
  ) as HTMLOListElement

  // The window growing, whatever grew it: "Show earlier", a reveal, or the caller showing everything.
  createEffect(on(() => props.hidden ?? 0, (next, previous) => {
    if (previous !== undefined && next < previous) counts.expansions += 1
  }))

  if (!props.follow) return list

  // The reader's place, as this component last understood it. `props.place` is the truth; this is what
  // the corrections below are aimed at.
  let place: ReadingPlace = LIVE
  let opened = false
  // Bumped when the caller hands over a different place, so a frame the outgoing list scheduled cannot
  // move the incoming one.
  let generation = 0
  let frame = 0
  let corrections = 0
  // Our own writes, marked until the frame after them, and when the reader last touched this
  // (../../lib/scrollAuthor.ts). A scroll event arrives after the write that caused it, and telling
  // ours from the reader's by comparing positions does not survive the fractional device pixels a
  // WebView reports.
  const author = createScrollAuthor()
  // Armed by the reader's own input and spent on the next scroll event, which is how a decision to
  // scroll up is told apart from the browser clamping scrollTop under a shrinking list. Momentum
  // keeps delivering scroll events long after the gesture, but the place is already captured by then.
  let userDriven = false
  // How long ago the reader last touched this is `author.fresh()`, which is a different question from
  // `userDriven`: that says an input has not been spent yet, this says how recent it was. A scrollbar
  // drag and a flick of momentum both deliver many scroll events for one gesture, and `userDriven` is
  // spent on the first of them, so the rest would read as moves nobody made. Nothing scrolls a second
  // after the reader stopped touching it (`GESTURE_MS`).
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

  /** The earliest drawn turn holding the reader's selection or focus, or -1. Those are the turns a
   *  trim must never take out of the DOM: removing them would drop the selection or the focus. */
  const held = (rows: HTMLElement[]): number => {
    const nodes: Node[] = []
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed) {
      if (selection.anchorNode) nodes.push(selection.anchorNode)
      if (selection.focusNode) nodes.push(selection.focusNode)
    }
    const active = document.activeElement
    if (active && list.contains(active)) nodes.push(active)
    let earliest = -1
    for (const node of nodes) {
      const index = rows.findIndex((row) => row.contains(node))
      if (index >= 0 && (earliest < 0 || index < earliest)) earliest = index
    }
    return earliest
  }

  /**
   * Hand the oldest turns back to the caller. Only while following the live end, which is the one
   * place a reader is not looking at them, and only once twice a page is drawn, so a streaming session
   * trims once a page rather than once an event.
   */
  const trim = () => {
    if (!props.onTrim || list.childElementCount < 2 * TIMELINE_PAGE) return
    const rows = turns()
    const normal = rows.length - TIMELINE_PAGE
    const holding = held(rows)
    const cut = holding >= 0 && holding < normal ? holding : normal
    counts.pinned = normal - cut
    const key = cut > 0 ? rows[cut]?.dataset.turn : undefined
    if (!key) return
    counts.trims += 1
    props.onTrim(key)
  }

  const write = (top: number) => {
    if (!scroller) return
    author.write(scroller, top)
    at = scroller.scrollTop
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
    const keys = rows.map((row) => row.dataset.turn ?? '')
    // A turn the caller's window is hiding has not gone. Ask for it, and put the reader on it next
    // frame, rather than handing them a neighbour.
    if (!keys.includes(place.key) && props.reveal?.(place.key)) {
      schedule()
      return
    }
    const found = resolveAnchor(place, keys)
    if (!found) {
      counts.failed += 1
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
      counts.corrections += 1
      counts.maxPixels = Math.max(counts.maxPixels, Math.abs(delta))
      write(before + delta)
      // Asked and refused: this list cannot bring that turn any closer, so this is as near as the
      // reader can be put and there is nothing to gain by asking again.
      settled = scroller.scrollTop === before
      if (settled) counts.drift = Math.max(counts.drift, Math.abs(delta))
    }
    if (!settled) {
      if (++corrections < CORRECTIONS) schedule()
      else {
        corrections = 0
        counts.drift = Math.max(counts.drift, Math.abs(delta))
      }
      return
    }
    corrections = 0
    // Settling does not redefine where the reader wants to be. It used to: it re-measured and adopted
    // whatever was under the viewport, so a settle that happened while the list was still short adopted
    // the top and wrote it to the caller's store, and every later visit opened there. The one thing
    // worth adopting is a substitute, because the turn the reader chose has left the list for good and
    // chasing its key would cost a correction on every resize from here on.
    if (found.key === place.key) return
    counts.substituted += 1
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
    if (!scroller || author.applying()) return
    // Armed, and recently enough to be about this move. Without the second half a click that scrolled
    // nothing stayed armed until something else moved the view, and that move was then adopted as the
    // reader's place and written to the caller's store, where it outlived the mount that invented it.
    const fresh = author.fresh()
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
    author.input()
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

  // The reader's own press, so the turn they are looking at becomes their place, and the older turns
  // arriving above it are growth to correct for like any other.
  const showEarlier = () => {
    const current = measure()
    if (current) adopt(current)
    props.onShowEarlier?.()
    correct()
  }

  // The list grows for two reasons and the response is the same rule either way: sit on the foot, or
  // put the anchor turn back under the reader. The scroller is observed too, because something
  // appearing above it shortens the viewport without touching the list.
  const growth = new ResizeObserver(() => {
    if (place.at === 'live') {
      trim()
      pin()
    } else schedule()
  })
  counts.observers += 1
  growth.observe(list)
  counts.observed += 1

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
  counts.observers += 1
  onMount(() => {
    if (!scroller?.parentElement) return
    replaced.observe(scroller.parentElement, { childList: true })
    counts.observed += 1
  })
  scheduledFrames = () => (frame ? 1 : 0) + author.pendingFrames()

  onCleanup(() => {
    growth.disconnect()
    replaced.disconnect()
    counts.observers -= 2
    counts.observed = 0
    if (frame) cancelAnimationFrame(frame)
    author.dispose()
    frame = 0
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
        counts.observed += 1
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
      <Show when={props.hidden}>
        {(hidden) => (
          <div class="ui-timeline-earlier">
            <Button variant="ghost" size="sm" onPress={showEarlier}>
              Show earlier ({hidden().toLocaleString()})
            </Button>
          </div>
        )}
      </Show>
      {list}
    </div>
  )
}

/** One turn. Wraps its child in the list item the timeline needs, so a caller composes Cards
 *  rather than remembering to write an `<li>`.
 *
 *  `key` is what a followed timeline puts the reader back on. Without it the list can still be drawn
 *  and followed, but it has no places to remember, so give one to every turn or to none.
 *
 *  `position` and `setSize` are the turn's place in the whole conversation, one-based, for a caller
 *  drawing only part of it: without them a screen reader counts the drawn turns and calls the first
 *  one "1 of 200" when it is the 3,188th of 3,387.
 *
 *  Children may be a function of `near`, which turns true once the turn comes within a screen of the
 *  viewport and stays true. A caller builds its expensive body there and draws a summary until then,
 *  so a long conversation opens without building every body in it. */
Timeline.Turn = (props: {
  key?: string
  position?: number
  setSize?: number
  children: JSX.Element | ((near: Accessor<boolean>) => JSX.Element)
}) => {
  const watch = useContext(NearTurns)
  const [near, setNear] = createSignal(false)
  let item!: HTMLLIElement
  let stop: (() => void) | undefined
  onCleanup(() => stop?.())
  // Read once per evaluation, the way `Show` reads its children: a function child is called, anything
  // else is what the caller wrote.
  const content = () => {
    const child = props.children
    if (typeof child !== 'function' || child.length === 0) return child as JSX.Element
    if (!stop) stop = watch ? watch(item, () => setNear(true)) : (setNear(true), undefined)
    return untrack(() => (child as (near: Accessor<boolean>) => JSX.Element)(near))
  }
  return (
    <li ref={item} class="ui-timeline-turn" data-turn={props.key} aria-posinset={props.position} aria-setsize={props.setSize}>
      {content()}
    </li>
  )
}
