import { createSignal, Index } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Card } from '../primitives'
import { Timeline } from './Timeline'
import { setScrollPlaceHandler, type ScrollPlaceReport } from '../../lib/scrollPlace'

// The transcript's two guardrails, at the node that owns them: appending a turn must not replace the
// ones already drawn, and following the newest turn must stop when the reader scrolls away from it
// (docs/ui-design.md § The closed kit, on Timeline's two guardrails).

let dispose: (() => void) | undefined
let host: HTMLElement
let observers: (() => void)[] = []

/** jsdom implements neither layout nor ResizeObserver. Both are stubbed rather than guarded in the
 *  node: every real host has them, and an optional call there would hide a genuine break. */
class TestResizeObserver {
  constructor(private readonly run: () => void) {
    observers.push(() => this.run())
  }
  observe() {}
  disconnect() {}
}

/** Give an element a height, so `nearBottom` has something to compare. */
const measure = (element: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
}

const grow = () => observers.forEach((run) => run())

beforeEach(() => {
  // A clock this test can move: the timeline tells a drag from a move nobody made by how long ago the
  // reader last touched it, and a test does everything in the same millisecond.
  vi.useFakeTimers()
  observers = []
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  vi.useRealTimers()
  dispose?.()
  dispose = undefined
  setScrollPlaceHandler(null)
  host.remove()
})

/** Collect what the timeline says about where it put the reader (../../lib/scrollPlace.ts). */
const watchPlaces = (): ScrollPlaceReport[] => {
  const seen: ScrollPlaceReport[] = []
  setScrollPlaceHandler((report) => seen.push(report))
  return seen
}

const scroller = () => host.querySelector('.ui-timeline-scroll') as HTMLElement | null

function mount(turns: () => readonly string[], viewKey: () => string) {
  dispose = render(() => (
    <Timeline follow viewKey={viewKey()}>
      <Index each={turns()}>
        {(turn) => <Timeline.Turn><Card>{turn()}</Card></Timeline.Turn>}
      </Index>
    </Timeline>
  ), host)
}

describe('Timeline', () => {
  it('is a plain list until it is told to follow', () => {
    dispose = render(() => <Timeline><Timeline.Turn><Card>one</Card></Timeline.Turn></Timeline>, host)
    expect(scroller()).toBeNull()
    expect(host.querySelector('.ui-timeline')).not.toBeNull()
  })

  it('keeps the turns already drawn when one is appended', () => {
    const [turns, setTurns] = createSignal(['one', 'two'])
    mount(turns, () => 'session-a')
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
    mount(turns, () => 'session-a')
    const box = scroller()!
    measure(box, 400, 100)
    setTurns(['one', 'two'])
    grow()
    expect(box.scrollTop).toBe(400)
  })

  it('leaves the reader alone once they scroll away from the bottom', () => {
    const [turns, setTurns] = createSignal(['one'])
    mount(turns, () => 'session-a')
    const box = scroller()!
    measure(box, 400, 100)
    grow()
    // A gesture, then a scroll well clear of the bottom: that is the reader, not a clamp.
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    box.scrollTop = 10
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    setTurns(['one', 'two'])
    grow()
    expect(box.scrollTop).toBe(10)
  })

  it('leaves a reader in place when the list shrinks under them', () => {
    // Reading up the list, then the content collapses — a filter drops rows, the tools shut — and the
    // browser clamps the scroll near the new, closer bottom. That clamp is not the reader asking to
    // follow, so the view must not snap to the bottom on the next layout.
    const [turns, setTurns] = createSignal(['one', 'two', 'three', 'four'])
    mount(turns, () => 'session-a')
    const box = scroller()!
    measure(box, 400, 100)
    grow()
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    box.scrollTop = 40
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    // The list collapses to something that only just overflows, and the browser clamps the reader near
    // its bottom. No gesture this time: this is the shrink, not the reader.
    setTurns(['one', 'two'])
    measure(box, 120, 100)
    box.scrollTop = 20
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    // A later layout settle — code highlighting, an image — must not be read as a cue to follow, and
    // the place the reader was actually reading is chased back as the list returns.
    grow()
    expect(box.scrollTop).toBe(40)
  })

  it('does not let a clamp become the place it gives back', () => {
    // The same shrink, but the reader leaves the view and comes back. The clamp must not have been
    // saved as where they were, or every later visit opens at the top of the transcript.
    const [view, setView] = createSignal('session-a')
    mount(() => ['one', 'two', 'three', 'four'], view)
    const box = scroller()!
    measure(box, 400, 100)
    grow()
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    box.scrollTop = 40
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    // The list collapses to less than a viewport and the browser clamps the reader to the top.
    measure(box, 100, 100)
    box.scrollTop = 0
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    measure(box, 400, 100)
    setView('session-b')
    setView('session-a')
    expect(box.scrollTop).toBe(40)
  })

  it('gives a reader back the place they left, per view', () => {
    const [view, setView] = createSignal('session-a')
    mount(() => ['one'], view)
    const box = scroller()!
    measure(box, 400, 100)
    grow()
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    box.scrollTop = 40
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    // A different list: the newest turn, not the offset the other view was left at.
    setView('session-b')
    expect(box.scrollTop).toBe(400)
    setView('session-a')
    expect(box.scrollTop).toBe(40)
  })

  it('says so when something other than the reader moves the view', () => {
    // The open question behind this: a transcript that jumps to the top while an agent streams into
    // it. Neither the reader nor this component asked, and the position alone cannot say who did, so
    // the move is reported with the numbers around it rather than guessed at.
    const seen = watchPlaces()
    mount(() => ['one', 'two', 'three'], () => 'session-a')
    const box = scroller()!
    measure(box, 4000, 100)
    grow()
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    box.scrollTop = 2000
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    seen.length = 0

    // Long enough after the reader last touched it that a drag or a flick of momentum is out.
    vi.advanceTimersByTime(2000)
    // Nowhere near the bottom either, so this is neither the reader nor a clamp.
    box.scrollTop = 0
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(seen).toEqual([
      { view: 'session-a', cause: 'unasked', from: 2000, to: 0, height: 4000, viewport: 100, following: false },
    ])
  })

  it('does not report a clamp, which it can account for', () => {
    const seen = watchPlaces()
    mount(() => ['one', 'two'], () => 'session-a')
    const box = scroller()!
    measure(box, 400, 100)
    grow()
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    box.scrollTop = 200
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    seen.length = 0

    measure(box, 100, 100)
    box.scrollTop = 0
    box.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(seen).toEqual([])
  })

  it('reports the place a list opens at, which is the only sign of a remount', () => {
    const seen = watchPlaces()
    mount(() => ['one'], () => 'session-a')
    const box = scroller()!
    measure(box, 400, 100)
    expect(seen.map((report) => report.cause)).toEqual(['opened'])
  })
})
