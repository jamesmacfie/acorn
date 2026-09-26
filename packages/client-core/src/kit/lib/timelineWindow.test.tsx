import { batch, createComputed, createRoot, createSignal } from 'solid-js'
import { afterEach, describe, expect, it } from 'vitest'
import { createTimelineWindow, revealStart, TIMELINE_PAGE, windowStart, type TimelineWindow } from './timelineWindow'

// The window a long timeline is drawn through: counted in turns and held by the oldest key drawn, so
// that nothing the reader did not ask for ever takes a turn out of the DOM.

const keysOf = (count: number, from = 0) => Array.from({ length: count }, (_, index) => `k${from + index}`)

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); dispose = undefined })

const windowOver = (initial: string[]) => {
  const [keys, setKeys] = createSignal(initial)
  let window!: TimelineWindow
  createRoot((done) => {
    dispose = done
    window = createTimelineWindow(keys)
  })
  return { window, setKeys }
}

describe('where a window starts', () => {
  it('holds its oldest key, and keeps its size when that key has gone', () => {
    expect(windowStart(['a', 'b', 'c', 'd'], 'b', 3)).toBe(1)
    expect(windowStart(['a', 'c', 'd', 'e'], 'b', 3)).toBe(1)
    expect(windowStart(['a', 'b'], null, 5)).toBe(0)
  })

  it('reveals by whole pages', () => {
    expect(revealStart(1000, 999)).toBe(1000 - TIMELINE_PAGE)
    expect(revealStart(1000, 1000 - TIMELINE_PAGE - 1)).toBe(1000 - 2 * TIMELINE_PAGE)
    expect(revealStart(150, 3)).toBe(0)
  })
})

describe('a timeline window', () => {
  it('opens on the newest page and says how many turns it hides', () => {
    const { window } = windowOver(keysOf(1000))
    expect(window.keys()).toHaveLength(TIMELINE_PAGE)
    expect(window.keys()[0]).toBe(`k${1000 - TIMELINE_PAGE}`)
    expect(window.start()).toBe(1000 - TIMELINE_PAGE)
  })

  it('lets appended turns join it rather than sliding it', () => {
    const { window, setKeys } = windowOver(keysOf(1000))
    const first = window.keys()[0]
    setKeys(keysOf(1010))
    expect(window.keys()[0]).toBe(first)
    expect(window.keys()).toHaveLength(TIMELINE_PAGE + 10)
  })

  it('waits for a list that starts empty rather than holding nothing', () => {
    const { window, setKeys } = windowOver([])
    expect(window.keys()).toEqual([])
    setKeys(keysOf(500))
    expect(window.keys()).toHaveLength(TIMELINE_PAGE)
  })

  it('adds one page on "Show earlier", and everything on "Show all"', () => {
    const { window } = windowOver(keysOf(1000))
    window.showEarlier()
    expect(window.keys()).toHaveLength(2 * TIMELINE_PAGE)
    window.showAll()
    expect(window.keys()).toHaveLength(1000)
    expect(window.start()).toBe(0)
  })

  it('reveals a hidden key and refuses one that is drawn or unknown', () => {
    const { window } = windowOver(keysOf(1000))
    expect(window.reveal('k999')).toBe(false)
    expect(window.reveal('nope')).toBe(false)
    expect(window.reveal('k10')).toBe(true)
    expect(window.keys()).toContain('k10')
    expect(window.start()).toBe(0)
  })

  it('keeps its size when its oldest key leaves the list', () => {
    const { window, setKeys } = windowOver(keysOf(1000))
    const oldest = window.keys()[0]
    setKeys(keysOf(1000).filter((key) => key !== oldest))
    expect(window.keys()).toHaveLength(TIMELINE_PAGE)
  })

  it('trims only forwards, and a reset goes back to the newest page for a new list', () => {
    const { window, setKeys } = windowOver(keysOf(1000))
    window.showAll()
    window.trim('k900')
    expect(window.keys()[0]).toBe('k900')
    // A trim to a key older than the window's start is not a trim.
    window.trim('k10')
    expect(window.keys()[0]).toBe('k900')
    setKeys(keysOf(600, 5000))
    window.reset()
    expect(window.keys()).toHaveLength(TIMELINE_PAGE)
    expect(window.keys()[0]).toBe(`k${5000 + 600 - TIMELINE_PAGE}`)
  })

  it('starts a new list on its newest page in the same pass that reads its keys', () => {
    const [list, setList] = createSignal('one')
    const [keys, setKeys] = createSignal(keysOf(1000))
    let window!: TimelineWindow
    const drawn: number[] = []
    createRoot((done) => {
      dispose = done
      window = createTimelineWindow(keys, list)
      createComputed(() => drawn.push(window.keys().length))
    })
    window.showAll()
    drawn.length = 0
    // The list and its keys change together, as a session switch does. Nothing is ever drawn at the
    // old window's size over the new keys.
    batch(() => {
      setKeys(keysOf(900, 5000))
      setList('two')
    })
    expect(drawn).toEqual([TIMELINE_PAGE])
    expect(window.keys()[0]).toBe(`k${5000 + 900 - TIMELINE_PAGE}`)
  })
})
