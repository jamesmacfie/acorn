import { createSignal, For } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Card } from '../primitives'
import { Timeline } from './Timeline'
import { LIVE, type ReadingPlace } from '../../lib/readingPlace'
import { setScrollPlaceHandler, type ScrollPlaceReport } from '../../lib/scrollPlace'

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

  it('reports the place a list opens at, which is the only sign of a remount', () => {
    const seen = watchPlaces()
    const [turns] = createSignal(['a', 'b'])
    mount(turns)
    expect(seen.map((report) => report.cause)).toEqual(['opened'])
  })
})
