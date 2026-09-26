import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDiffMeasureScheduler, type DiffMeasureSchedulerOptions } from './measureScheduler'

// When the diff reads its dynamic blocks and commits their heights (./measureScheduler.ts), with the
// observer and the frames modelled: elements are plain objects with a height, the observer reports
// only when a test says the browser would, and a frame runs only when a test flushes it.

type Fake = { isConnected: boolean; height: number }

let frames: (() => void)[] = []
let observers: { callback: ResizeObserverCallback; watched: Set<unknown>; disconnected: boolean }[] = []

class ModelResizeObserver {
  private readonly own = { callback: (() => {}) as ResizeObserverCallback, watched: new Set<unknown>(), disconnected: false }
  constructor(callback: ResizeObserverCallback) {
    this.own.callback = callback
    observers.push(this.own)
  }
  observe(element: unknown) { this.own.watched.add(element) }
  unobserve(element: unknown) { this.own.watched.delete(element) }
  disconnect() {
    this.own.disconnected = true
    this.own.watched.clear()
  }
}

/** The browser reporting these elements resized, after layout and before paint. */
const report = (...elements: Fake[]) => {
  for (const observer of observers) {
    const due = elements.filter((element) => observer.watched.has(element))
    if (due.length && !observer.disconnected) observer.callback(due.map((target) => ({ target, contentRect: { width: 800, height: 600 } })) as unknown as ResizeObserverEntry[], {} as ResizeObserver)
  }
}

/** Run the frames that are due, as the next animation frame would. */
const nextFrame = () => {
  const due = frames
  frames = []
  for (const run of due) run()
}

beforeEach(() => {
  frames = []
  observers = []
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.stubGlobal('ResizeObserver', ModelResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    frames.push(() => run(0))
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A scheduler over a map of held heights, recording every commit. */
function setup(overrides: Partial<DiffMeasureSchedulerOptions> = {}) {
  const held = new Map<string, number>()
  const commits: Map<string, number>[] = []
  const reads: string[] = []
  const elements = new Map<string, Fake>()
  const scheduler = createDiffMeasureScheduler({
    held: (id) => held.get(id),
    above: () => false,
    readerWait: () => 0,
    commit: (changes) => {
      commits.push(new Map(changes))
      for (const [id, height] of changes) held.set(id, height)
    },
    read: (element) => {
      for (const [id, candidate] of elements) if ((candidate as unknown) === element) reads.push(id)
      return (element as unknown as Fake).height
    },
    ...overrides,
  })
  const block = (id: string, height: number, base = 0) => {
    const element: Fake = { isConnected: true, height }
    elements.set(id, element)
    held.set(id, height)
    scheduler.observe(element as unknown as Element, id, base)
    return element
  }
  return { scheduler, held, commits, reads, block }
}

describe('the diff measure scheduler', () => {
  it('reads a burst of resizes in one batch and commits once in a frame', () => {
    const { scheduler, commits, reads, block } = setup()
    const blocks = Array.from({ length: 20 }, (_, n) => block(`t:${n}`, 100))
    for (const element of blocks) element.height = 180
    report(...blocks)
    expect(reads).toHaveLength(20)
    expect(commits).toHaveLength(1)
    expect(commits[0]!.size).toBe(20)

    // A second resize in the same frame waits for the next one rather than committing twice.
    blocks[0]!.height = 240
    report(blocks[0]!)
    expect(commits).toHaveLength(1)
    nextFrame()
    expect(commits).toHaveLength(2)
    expect(scheduler.counts.maxCommitsInFrame).toBe(1)
  })

  it('reads a mounted dirty block even when the height it holds is current, and commits nothing for it', () => {
    const { scheduler, commits, reads, block } = setup()
    const element = block('t:a', 120)
    report(element)
    expect(reads).toEqual(['t:a'])
    expect(commits).toEqual([])
    expect(scheduler.counts.reads).toBe(1)
    expect(scheduler.counts.commits).toBe(0)
  })

  it('never reads a block that is not mounted', () => {
    const { commits, reads, block } = setup()
    const gone = block('t:gone', 100)
    const here = block('t:here', 100)
    gone.isConnected = false
    gone.height = here.height = 300
    report(gone, here)
    expect(reads).toEqual(['t:here'])
    expect(commits[0]).toEqual(new Map([['t:here', 300]]))
  })

  it('holds back a block above the reader while they scroll, and commits it once the scroll settles', () => {
    let wait = 150
    const { commits, block } = setup({ readerWait: () => wait, above: (id) => id === 't:above' })
    const above = block('t:above', 100)
    const below = block('t:below', 100)
    above.height = below.height = 250
    report(above, below)
    // What sits below the reader moves nothing they are looking at, so it lands at once.
    expect(commits).toEqual([new Map([['t:below', 250]])])

    // The reader is still going: nothing more until they stop.
    wait = 0
    nextFrame()
    vi.advanceTimersByTime(149)
    nextFrame()
    expect(commits).toHaveLength(1)
    vi.advanceTimersByTime(1)
    nextFrame()
    expect(commits).toEqual([new Map([['t:below', 250]]), new Map([['t:above', 250]])])
  })

  it('subtracts the fixed part of a block, such as the code line above a note', () => {
    const { commits, block } = setup()
    const element = block('l:new:3:src/a.ts', 20, 20)
    element.height = 64
    report(element)
    expect(commits[0]).toEqual(new Map([['l:new:3:src/a.ts', 44]]))
  })

  it('without an observer, measures each block once when it mounts', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const { scheduler, commits, block } = setup()
    const element = block('t:a', 100)
    element.height = 150
    expect(commits).toEqual([])
    nextFrame()
    expect(commits).toEqual([new Map([['t:a', 150]])])
    expect(scheduler.counts.activeObservers).toBe(0)
  })

  it('returns observers, elements, dirty blocks, frames and timers to zero when disposed', () => {
    const { scheduler, block } = setup({ readerWait: () => 150, above: () => true })
    const viewport = { isConnected: true, height: 600, clientWidth: 800, clientHeight: 600 }
    scheduler.observeViewport(viewport as unknown as HTMLElement)
    const element = block('t:a', 100)
    element.height = 200
    report(element)
    expect(scheduler.counts.activeObservers).toBe(1)
    expect(scheduler.observedElements()).toBe(2)
    expect(scheduler.pending()).toBe(1)
    expect(scheduler.pendingFrames()).toBeGreaterThan(0)

    scheduler.dispose()
    expect(scheduler.counts.activeObservers).toBe(0)
    expect(scheduler.observedElements()).toBe(0)
    expect(scheduler.pending()).toBe(0)
    expect(scheduler.pendingFrames()).toBe(0)
    expect(observers.every((observer) => observer.disconnected)).toBe(true)
  })
})
