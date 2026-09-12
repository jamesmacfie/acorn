import { createSignal, Index } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Card } from '../primitives'
import { Timeline } from './Timeline'

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
  observers = []
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

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
})
