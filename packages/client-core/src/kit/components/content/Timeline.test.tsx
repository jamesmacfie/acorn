import { createSignal, For, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Card } from '../primitives'
import { Timeline } from './Timeline'
import { LIVE, type ReadingPlace } from '../../lib/timeline/readingPlace'
import { setScrollPlaceHandler, type ScrollPlaceReport } from '../../lib/telemetry/scrollPlace'
import { _resetSurfaceHealth, surfaceHealthSnapshot } from '../../lib/telemetry/surfaceHealth'
import { createTimelineWindow, TIMELINE_PAGE } from '../../lib/timeline/timelineWindow'

// The transcript's guardrails, at the node that owns them: appending a turn must not replace the ones
// already drawn, following the newest turn must stop when the reader scrolls away from it, and a
// reader who comes back to a list must come back to the turn they left
// (docs/ui-design.md § The closed kit).
//
// jsdom has no layout, so the geometry is a model: turn heights, a viewport, and a `scrollTop` that
// CLAMPS the way a browser does. That clamp is the whole point of the harness. Without it a test can
// set `scrollTop` to an offset the list is too short to reach and assert it stuck, which is the one
// thing a browser will not do and the reason this bug went two rounds without a failing test.

let dispose: (() => void) | undefined
let host: HTMLElement
let observers: (() => void)[] = []
let frames: (() => void)[] = []

class TestResizeObserver {
  constructor(private readonly run: () => void) {
    observers.push(() => this.run())
  }
  observe() {}
  disconnect() {}
}

/** The list's geometry, in insertion order. */
let heights = new Map<string, number>()
let viewport = 100
let scrollTop = 0

const content = (): number => [...heights.values()].reduce((total, height) => total + height, 0)
const maxScroll = (): number => Math.max(0, content() - viewport)
const topOf = (key: string): number => {
  let y = 0
  for (const [candidate, height] of heights) {
    if (candidate === key) return y
    y += height
  }
  return y
}

/** Give the scroller and every turn now in the DOM their geometry. Called after any change that
 *  mounts rows, because the rows the component measures are the ones the browser has laid out. */
const layout = () => {
  const box = host.querySelector<HTMLElement>('.ui-timeline-scroll')
  if (box) {
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => content() })
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => viewport })
    Object.defineProperty(box, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (to: number) => { scrollTop = Math.max(0, Math.min(Math.round(to), maxScroll())) },
    })
    box.getBoundingClientRect = () => ({ top: 0, bottom: viewport, height: viewport }) as DOMRect
  }
  for (const row of host.querySelectorAll<HTMLElement>('.ui-timeline-turn')) {
    const key = row.dataset.turn ?? ''
    Object.defineProperty(row, 'offsetHeight', { configurable: true, get: () => heights.get(key) ?? 0 })
    row.getBoundingClientRect = () => {
      const top = topOf(key) - scrollTop
      return { top, bottom: top + (heights.get(key) ?? 0), height: heights.get(key) ?? 0 } as DOMRect
    }
  }
}

/** One settle: the browser reporting the list's new size, then the frames that follow. */
const settle = (rounds = 6) => {
  layout()
  observers.forEach((run) => run())
  for (let i = 0; i < rounds; i++) {
    const queued = frames
    frames = []
    for (const run of queued) run()
  }
}

const scroller = () => host.querySelector('.ui-timeline-scroll') as HTMLElement | null
/** Where a turn's top edge sits against the top of the viewport. The only honest assertion here: a
 *  bare `scrollTop` says nothing once the content above it has changed height. */
const turnTop = (key: string) => host.querySelector<HTMLElement>(`[data-turn="${key}"]`)!.getBoundingClientRect().top

const reader = (box: HTMLElement, to: number) => {
  box.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
  box.scrollTop = to
  box.dispatchEvent(new Event('scroll', { bubbles: true }))
}

beforeEach(() => {
  // A clock the tests can move: the timeline tells a drag from a move nobody made by how long ago the
  // reader last touched it, and a test does everything in the same millisecond. Only the clock, because
  // the frames are stubbed below and a faked `requestAnimationFrame` would be restored out from under
  // the component's cleanup.
  vi.useFakeTimers({ toFake: ['Date'] })
  observers = []
  frames = []
  heights = new Map()
  viewport = 100
  scrollTop = 0
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver
  globalThis.requestAnimationFrame = ((run: FrameRequestCallback) => {
    frames.push(() => run(0))
    return frames.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.useRealTimers()
  setScrollPlaceHandler(null)
  host.remove()
})

const watchPlaces = (): ScrollPlaceReport[] => {
  const seen: ScrollPlaceReport[] = []
  setScrollPlaceHandler((report) => seen.push(report))
  return seen
}

/** A list of turns, each `height` tall, and a place the caller remembers for it. */
function mount(turns: () => readonly string[], height = 100) {
  let held: ReadingPlace = LIVE
  const [place, setPlace] = createSignal<ReadingPlace>(LIVE)
  const draw = () => {
    for (const key of turns()) if (!heights.has(key)) heights.set(key, height)
    dispose = render(() => (
      <Timeline follow place={place} onChange={(next) => { held = next; setPlace(next) }}>
        <For each={turns()}>
          {(key) => <Timeline.Turn key={key}><Card>{key}</Card></Timeline.Turn>}
        </For>
      </Timeline>
    ), host)
    settle()
  }
  draw()
  return {
    place: () => held,
    /** Hand over the place for another list, which is what swapping one session's stream for
     *  another's does: the caller reads its store under the new view's key and passes what it finds. */
    hand: (next: ReadingPlace) => setPlace(next),
    /** Throw the component away and build it again, which is what a workspace switch does. */
    remount: () => {
      dispose?.()
      dispose = undefined
      host.replaceChildren()
      scrollTop = 0
      setPlace(held)
      draw()
    },
  }
}

describe('Timeline', () => {
  it('is a plain list until it is told to follow', () => {
    dispose = render(() => <Timeline><Timeline.Turn><Card>one</Card></Timeline.Turn></Timeline>, host)
    expect(scroller()).toBeNull()
    expect(host.querySelector('.ui-timeline')).not.toBeNull()
  })

  it('keeps the turns already drawn when one is appended', () => {
    const [turns, setTurns] = createSignal(['one', 'two'])
    mount(turns)
    const before = [...host.querySelectorAll('.ui-timeline-turn')]
    expect(before).toHaveLength(2)
    setTurns(['one', 'two', 'three'])
    const after = [...host.querySelectorAll('.ui-timeline-turn')]
    expect(after).toHaveLength(3)
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
  })

  it('stays on the newest turn as the list grows', () => {
    const [turns, setTurns] = createSignal(['one'])
    mount(turns)
    setTurns(['one', 'two', 'three', 'four'])
    settle()
    expect(scrollTop).toBe(maxScroll())
  })

  it('leaves the reader alone once they scroll away from the foot', () => {
    const [turns, setTurns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    const view = mount(turns)
    reader(scroller()!, 200)
    expect(view.place()).toMatchObject({ at: 'turn', key: 'c' })
    setTurns(['a', 'b', 'c', 'd', 'e', 'f'])
    settle()
    expect(turnTop('c')).toBe(0)
  })

  it('holds the reader on their turn when the list shrinks under them', () => {
    // Reading up the list, then a card collapses. The browser clamps the scroll to the only offset
    // left, which is not the reader asking to be moved, so the view goes back to their turn.
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    mount(turns)
    reader(scroller()!, 200)
    expect(turnTop('c')).toBe(0)
    heights.set('a', 20)
    heights.set('b', 20)
    layout()
    scrollTop = maxScroll()
    scroller()!.dispatchEvent(new Event('scroll', { bubbles: true }))
    settle()
    expect(turnTop('c')).toBe(0)
  })

  it('keeps the reader on their turn while the content above it grows', () => {
    // The one a saved pixel offset can never do. A code fence streams, an image decodes, highlighting
    // lands: everything above the reader gets taller and their turn has to stay put.
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    mount(turns)
    reader(scroller()!, 200)
    expect(turnTop('c')).toBe(0)
    heights.set('a', 400)
    heights.set('b', 260)
    settle()
    expect(turnTop('c')).toBe(0)
  })

  it('puts the reader back on their turn after a remount, which had no layout when it opened', () => {
    // A workspace switch disposes the task's panes and builds them again. The list exists before it
    // has a height, so the first attempt to place the reader lands nowhere; the settle that follows is
    // what has to finish the job.
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    const view = mount(turns)
    reader(scroller()!, 200)
    expect(view.place()).toMatchObject({ at: 'turn', key: 'c' })
    view.remount()
    expect(turnTop('c')).toBe(0)
  })

  it('sends a reader to the newest turn when the list came back too short to hold their place', () => {
    // Never the top. An unreachable place is indistinguishable from a first visit, and a first visit
    // follows the newest turn.
    const [turns, setTurns] = createSignal(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    const view = mount(turns)
    reader(scroller()!, 600)
    expect(view.place()).toMatchObject({ at: 'turn', key: 'g' })
    setTurns(['a', 'b'])
    view.remount()
    expect(scrollTop).toBe(maxScroll())
    expect(view.place()).toEqual(LIVE)
  })

  it('lands on whatever took the place of a turn that has gone', () => {
    // A permission card resolving takes its row out of the middle of the list.
    const [turns, setTurns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    const view = mount(turns)
    reader(scroller()!, 200)
    expect(view.place()).toMatchObject({ at: 'turn', key: 'c', index: 2 })
    setTurns(['a', 'b', 'd', 'e', 'f'])
    view.remount()
    expect(turnTop('d')).toBe(0)
  })

  it('does not let settling redefine which turn the reader chose', () => {
    // The one that got through. A list too short to bring the anchor all the way up settles against the
    // clamp, and the old code then re-measured and adopted whatever was under the viewport — a turn or
    // two earlier. Every resize did it again, so the place walked up the list and the reader ended at
    // the top, a beat after landing in the right spot.
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    const view = mount(turns, 200)
    reader(scroller()!, 1300)
    expect(view.place()).toMatchObject({ at: 'turn', key: 'g' })

    // Every card collapses. The list is now too short to bring `g` to the top, so each correction ends
    // against the clamp rather than on the turn.
    for (const key of turns()) heights.set(key, 30)
    for (let i = 0; i < 5; i++) settle()
    expect(view.place()).toMatchObject({ at: 'turn', key: 'g' })
  })

  it('does not read a rebuilt pane restoring its own focus as the reader scrolling', () => {
    // A pane that comes back puts focus somewhere, and focus used to arm the next scroll event as the
    // reader's. The scroll that followed was the restore's own, measured while the list was still at
    // the top, so the top became the reader's place and stayed there.
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    const view = mount(turns)
    reader(scroller()!, 200)
    expect(view.place()).toMatchObject({ at: 'turn', key: 'c' })

    const list = host.querySelector('.ui-timeline')!
    list.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    scroller()!.scrollTop = 0
    scroller()!.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(view.place()).toMatchObject({ at: 'turn', key: 'c' })
  })

  it('does not take a place from a scroll that arrives while it is being torn down', () => {
    // The list drains as the subtree goes, and the scroll events that produces are nobody's reading
    // position. Writing one down poisoned the key for the life of the window.
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    const view = mount(turns)
    reader(scroller()!, 200)
    const box = scroller()!
    dispose?.()
    dispose = undefined
    box.scrollTop = 0
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(view.place()).toMatchObject({ at: 'turn', key: 'c' })
  })

  it('says so when something other than the reader moves the view', () => {
    const seen = watchPlaces()
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    mount(turns, 800)
    reader(scroller()!, 2000)
    seen.length = 0

    // Long enough after the reader last touched it that a drag or a flick of momentum is out, and
    // nowhere near the foot, so this is neither the reader nor a clamp.
    vi.advanceTimersByTime(2000)
    scroller()!.scrollTop = 0
    scroller()!.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(seen.map((report) => report.cause)).toEqual(['unasked'])
  })

  it('does not hand a move nobody made to a reader who clicked a card a while ago', () => {
    // A click arms a gesture and nothing spends it, because a click scrolls nothing. The arm used to
    // sit there until something else moved the view, and that move was then written down as the place
    // the reader chose — so it survived the correction that would otherwise have undone it, and the
    // caller stored it. Enough of them in a row and the place walks to the top and stays there.
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    const view = mount(turns)
    reader(scroller()!, 200)
    expect(view.place()).toMatchObject({ at: 'turn', key: 'c' })

    scroller()!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.advanceTimersByTime(2000)
    scroller()!.scrollTop = 0
    scroller()!.dispatchEvent(new Event('scroll', { bubbles: true }))
    settle()
    expect(view.place()).toMatchObject({ at: 'turn', key: 'c' })
    expect(turnTop('c')).toBe(0)
  })

  it('brings a reader who is following the newest turn back to it after a move nobody made', () => {
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    mount(turns)
    expect(scrollTop).toBe(maxScroll())

    vi.advanceTimersByTime(2000)
    scroller()!.scrollTop = 0
    scroller()!.dispatchEvent(new Event('scroll', { bubbles: true }))
    // The frames only. A resize would pin the reader whatever the correction did, and the case that
    // bit is the one where nothing resizes: the agent has stopped and the list is done growing.
    const queued = frames
    frames = []
    for (const run of queued) run()
    expect(scrollTop).toBe(maxScroll())
  })

  it('goes to the foot when the list swaps for a session the reader has no place in', () => {
    // Following one session, then the pane is pointed at another. The caller has no place stored for
    // the new one, so it hands over a live place — the same value the reader already had, for a
    // different list. Compared by value that reads as "nothing to do", and the reader was left at the
    // old list's offset partway down a transcript they have never seen.
    const [turns, setTurns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    const view = mount(turns)
    expect(scrollTop).toBe(maxScroll())

    setTurns(['f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'])
    heights.clear()
    for (const key of ['f', 'g', 'h', 'i', 'j', 'k', 'l', 'm']) heights.set(key, 100)
    view.hand({ at: 'live' })
    // The frames only. The new list is a different height, so a resize would pin the reader whatever
    // the swap did; two lists of the same height report no resize at all and there is nothing to
    // rescue it.
    layout()
    const queued = frames
    frames = []
    for (const run of queued) run()
    expect(scrollTop).toBe(maxScroll())
  })

  it('puts the reader back when the page takes the list away and returns it', async () => {
    // A pane region suspends after it has drawn — a query in it running with an empty cache — so every
    // child leaves the document and comes back. The browser resets a detached scroller to the top and
    // reports neither a scroll event nor a resize for it, which is why this is the one move the
    // timeline cannot hear about from the scroller itself.
    const [turns] = createSignal(['a', 'b', 'c', 'd', 'e'])
    mount(turns)
    expect(scrollTop).toBe(maxScroll())

    const box = scroller()!
    const parent = box.parentElement!
    box.remove()
    parent.append(box)
    scrollTop = 0
    // Mutation records are delivered on a microtask.
    await Promise.resolve()
    // The frames only. A resize would pin the reader whatever this did, and a list that is put back
    // the same size as it left reports no resize at all.
    const queued = frames
    frames = []
    for (const run of queued) run()
    expect(scrollTop).toBe(maxScroll())
  })

  it('reports the place a list opens at, which is the only sign of a remount', () => {
    const seen = watchPlaces()
    const [turns] = createSignal(['a', 'b'])
    mount(turns)
    expect(seen.map((report) => report.cause)).toEqual(['opened'])
  })
})

// The numbers a timeline reports about itself (kit/lib/telemetry/surfaceHealth.ts): the caller's projected turns
// and the turns in the DOM are separate fields, and teardown leaves no observer or frame behind.
describe('Timeline health', () => {
  afterEach(() => _resetSurfaceHealth())

  it('reports projected and mounted turns apart, and returns its observers and frames on teardown', () => {
    const [turns, setTurns] = createSignal(['a', 'b', 'c'])
    for (const key of ['a', 'b', 'c', 'd']) heights.set(key, 100)
    dispose = render(() => (
      <Timeline follow total={40}>
        <For each={turns()}>
          {(key) => <Timeline.Turn key={key}><Card>{key}</Card></Timeline.Turn>}
        </For>
      </Timeline>
    ), host)
    settle()

    let [entry] = surfaceHealthSnapshot().surfaces
    expect(entry?.kind).toBe('timeline')
    expect(entry?.topology.dynamicBlocks).toBe(40)
    expect(entry?.mounted.dynamicBlocks).toBe(3)
    expect(entry?.measurement.activeObservers).toBe(2)
    // The list and the scroller for size, the scroller's parent for being re-parented.
    expect(entry?.measurement.observedElements).toBe(3)

    // A new turn arrives and the timeline pins the reader to it: one write, one frame still owed.
    setTurns(['a', 'b', 'c', 'd'])
    layout()
    observers.forEach((run) => run())
    ;[entry] = surfaceHealthSnapshot().surfaces
    expect(entry?.mounted.dynamicBlocks).toBe(4)
    expect(entry?.work.scheduledFrames).toBeGreaterThan(0)

    dispose?.()
    dispose = undefined
    const snapshot = surfaceHealthSnapshot()
    expect(snapshot.surfaces).toEqual([])
    expect(snapshot.retired.timeline?.measurement.activeObservers).toBe(0)
    expect(snapshot.retired.timeline?.measurement.observedElements).toBe(0)
    expect(snapshot.retired.timeline?.work.scheduledFrames).toBe(0)
  })

  it('counts a plain run of cards, which has no observers of its own', () => {
    dispose = render(() => <Timeline><Timeline.Turn><Card>one</Card></Timeline.Turn></Timeline>, host)
    const [entry] = surfaceHealthSnapshot().surfaces
    expect(entry?.mounted.dynamicBlocks).toBe(1)
    expect(entry?.topology.dynamicBlocks).toBe(1)
    expect(entry?.measurement.activeObservers).toBe(0)
  })
})

// A long list drawn through a window (kit/lib/timeline/timelineWindow.ts): the caller draws the newest page, the
// timeline says how many older turns there are, and the reader's place is kept by identity while the
// window grows and shrinks. The geometry here is read from the DOM's order at every call, so a turn
// prepended or trimmed moves every turn after it the way a browser's layout would.
describe('Timeline window', () => {
  const sizes = new Map<string, number>()
  const drawn = () => [...host.querySelectorAll<HTMLElement>('.ui-timeline-turn')]
  const size = (row: HTMLElement) => sizes.get(row.dataset.turn ?? '') ?? 100
  const total = () => drawn().reduce((sum, row) => sum + size(row), 0)
  const originalRect = HTMLLIElement.prototype.getBoundingClientRect
  const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

  beforeEach(() => {
    sizes.clear()
    HTMLLIElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      let top = -scrollTop
      for (const row of drawn()) {
        if (row === this) return { top, bottom: top + size(row), height: size(row) } as DOMRect
        top += size(row)
      }
      return { top: 0, bottom: 0, height: 0 } as DOMRect
    }
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('ui-timeline-turn') ? size(this) : 0 },
    })
  })
  afterEach(() => {
    HTMLLIElement.prototype.getBoundingClientRect = originalRect
    if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalHeight)
    document.getSelection()?.removeAllRanges()
    _resetSurfaceHealth()
  })

  const box = () => {
    const element = scroller()!
    Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => total() })
    Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => viewport })
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (to: number) => { scrollTop = Math.max(0, Math.min(Math.round(to), Math.max(0, total() - viewport))) },
    })
    element.getBoundingClientRect = () => ({ top: 0, bottom: viewport, height: viewport }) as DOMRect
    return element
  }

  /** The browser reporting a resize, then the frames that follow. */
  const run = (rounds = 6) => {
    observers.forEach((notify) => notify())
    for (let i = 0; i < rounds; i++) {
      const queued = frames
      frames = []
      for (const next of queued) next()
    }
  }

  const keysOf = (count: number) => Array.from({ length: count }, (_, index) => `k${index}`)

  function mountWindowed(initial: string[], opening: ReadingPlace = LIVE) {
    const [keys, setKeys] = createSignal(initial)
    let held: ReadingPlace = opening
    const [place, setPlace] = createSignal<ReadingPlace>(opening)
    dispose = render(() => {
      const window = createTimelineWindow(keys)
      return (
        <Timeline
          follow
          place={place}
          onChange={(next) => { held = next; setPlace(next) }}
          total={keys().length}
          hidden={window.start()}
          onShowEarlier={window.showEarlier}
          reveal={window.reveal}
          onTrim={window.trim}
        >
          <For each={window.keys()}>
            {(key, index) => (
              <Timeline.Turn key={key} position={window.start() + index() + 1} setSize={keys().length}>
                <Card><span>{key}</span><button type="button">{`act ${key}`}</button></Card>
              </Timeline.Turn>
            )}
          </For>
        </Timeline>
      )
    }, host)
    box()
    run()
    return { keys, setKeys, place: () => held }
  }

  const earlier = () => [...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Show earlier'))

  it('draws the newest page, says how many turns it hides, and numbers each in the whole list', () => {
    mountWindowed(keysOf(1000))
    expect(drawn()).toHaveLength(TIMELINE_PAGE)
    expect(earlier()?.textContent).toBe('Show earlier (800)')
    expect(drawn()[0]?.getAttribute('aria-posinset')).toBe('801')
    expect(drawn()[0]?.getAttribute('aria-setsize')).toBe('1000')
    const [entry] = surfaceHealthSnapshot().surfaces
    expect(entry?.topology.dynamicBlocks).toBe(1000)
    expect(entry?.mounted.dynamicBlocks).toBe(TIMELINE_PAGE)
    expect(entry?.window.hiddenEarlier).toBe(800)
  })

  it('keeps the turn the reader was looking at where it was when "Show earlier" prepends a page', () => {
    const view = mountWindowed(keysOf(1000))
    reader(scroller()!, 250)
    expect(view.place()).toMatchObject({ at: 'turn', key: 'k802', offset: 50 })
    const before = drawn().find((row) => row.dataset.turn === 'k802')
    earlier()!.click()
    run()
    expect(drawn()).toHaveLength(2 * TIMELINE_PAGE)
    expect(turnTop('k802')).toBe(-50)
    // The same element: prepending drew new turns and replaced none.
    expect(drawn().find((row) => row.dataset.turn === 'k802')).toBe(before)
    expect(drawn()[0]?.getAttribute('aria-posinset')).toBe('601')
    expect(surfaceHealthSnapshot().surfaces[0]?.window.expansions).toBe(1)
  })

  it('opens a place in the hidden part of the list on that turn, not on a neighbour', () => {
    mountWindowed(keysOf(1000), { at: 'turn', key: 'k100', index: 3, offset: 20 })
    expect(drawn().some((row) => row.dataset.turn === 'k100')).toBe(true)
    expect(turnTop('k100')).toBe(-20)
    expect(surfaceHealthSnapshot().surfaces[0]?.correction.substituted).toBe(0)
  })

  it('lands on a neighbour only when the turn has left the list, and counts it', () => {
    const view = mountWindowed(keysOf(1000), { at: 'turn', key: 'gone', index: 3, offset: 0 })
    expect(view.place()).toMatchObject({ at: 'turn', key: 'k803' })
    expect(surfaceHealthSnapshot().surfaces[0]?.correction.substituted).toBe(1)
  })

  it('trims back to a page while following, once a page rather than once an event', () => {
    const view = mountWindowed(keysOf(1000))
    view.setKeys(keysOf(1000 + TIMELINE_PAGE - 1))
    run()
    expect(drawn()).toHaveLength(2 * TIMELINE_PAGE - 1)
    view.setKeys(keysOf(1000 + TIMELINE_PAGE))
    run()
    expect(drawn()).toHaveLength(TIMELINE_PAGE)
    expect(scrollTop).toBe(total() - viewport)
    const [entry] = surfaceHealthSnapshot().surfaces
    expect(entry?.window.trims).toBe(1)
    expect(entry?.window.hiddenEarlier).toBe(1000)
  })

  it('never trims a turn holding the selection or focus, and trims once they let go', () => {
    const view = mountWindowed(keysOf(1000))
    // Focus in the second drawn turn, then a selection in the oldest one. That order, because jsdom
    // puts a caret in whatever takes focus, and a selection only takes a range once that is cleared.
    const oldest = drawn()[0]!
    drawn()[1]!.querySelector('button')!.focus()
    const range = document.createRange()
    range.selectNodeContents(oldest.querySelector('span')!)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)

    view.setKeys(keysOf(1000 + TIMELINE_PAGE))
    run()
    expect(drawn()[0]).toBe(oldest)
    expect(document.getSelection()?.toString()).toBe('k800')
    expect(surfaceHealthSnapshot().surfaces[0]?.window.pinned).toBe(TIMELINE_PAGE)

    // The selection goes; the focus alone still holds its own turn, one below.
    document.getSelection()!.removeAllRanges()
    view.setKeys(keysOf(1000 + TIMELINE_PAGE + 1))
    run()
    expect(drawn()[0]?.dataset.turn).toBe('k801')

    ;(document.activeElement as HTMLElement).blur()
    view.setKeys(keysOf(1000 + TIMELINE_PAGE + 2))
    run()
    expect(drawn()).toHaveLength(TIMELINE_PAGE)
    expect(surfaceHealthSnapshot().surfaces[0]?.window.pinned).toBe(0)
  })

  it('leaves the window alone while the reader is away from the live end', () => {
    const view = mountWindowed(keysOf(1000))
    reader(scroller()!, 250)
    view.setKeys(keysOf(1000 + 2 * TIMELINE_PAGE))
    run()
    expect(drawn()).toHaveLength(3 * TIMELINE_PAGE)
    expect(turnTop('k802')).toBe(-50)
  })
})

// A turn whose body is a function of `near`: built once the turn comes near the viewport, drawn as
// the caller's summary until then, and the same list item either way.
describe('Timeline deferred bodies', () => {
  let watched: Element[] = []
  let notify: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | undefined
  class TestIntersectionObserver {
    constructor(run: (entries: { target: Element; isIntersecting: boolean }[]) => void) { notify = run }
    observe(element: Element) { watched.push(element) }
    unobserve(element: Element) { watched = watched.filter((item) => item !== element) }
    disconnect() { watched = [] }
  }
  beforeEach(() => {
    watched = []
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = TestIntersectionObserver
  })
  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    _resetSurfaceHealth()
  })

  it('builds a body when its turn comes near, in the same list item, and counts it', () => {
    let built = 0
    dispose = render(() => (
      <Timeline>
        <For each={['a', 'b', 'c']}>
          {(key) => (
            <Timeline.Turn key={key}>
              {(near) => (
                <Card>
                  <Show when={near()} fallback={<span>summary {key}</span>}>
                    {(() => { built += 1; return <span>body {key}</span> })()}
                  </Show>
                </Card>
              )}
            </Timeline.Turn>
          )}
        </For>
      </Timeline>
    ), host)
    const item = host.querySelector('[data-turn="b"]')!
    expect(watched).toHaveLength(3)
    expect(item.textContent).toBe('summary b')
    expect(built).toBe(0)

    notify!([{ target: item, isIntersecting: true }])
    expect(host.querySelector('[data-turn="b"]')).toBe(item)
    expect(item.textContent).toBe('body b')
    expect(built).toBe(1)
    expect(watched).toHaveLength(2)
    const [entry] = surfaceHealthSnapshot().surfaces
    expect(entry?.mounted.bodies).toBe(1)
    expect(entry?.measurement.activeObservers).toBe(1)
    expect(entry?.measurement.observedElements).toBe(2)

    dispose?.()
    dispose = undefined
    const retired = surfaceHealthSnapshot().retired.timeline
    expect(retired?.measurement.activeObservers).toBe(0)
    expect(retired?.measurement.observedElements).toBe(0)
    expect(retired?.mounted.bodies).toBe(0)
  })

  it('builds every body at once where nothing can say what is near', () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    dispose = render(() => (
      <Timeline>
        <Timeline.Turn key="a">{(near) => <Card>{near() ? 'body' : 'summary'}</Card>}</Timeline.Turn>
      </Timeline>
    ), host)
    expect(host.textContent).toBe('body')
  })
})
