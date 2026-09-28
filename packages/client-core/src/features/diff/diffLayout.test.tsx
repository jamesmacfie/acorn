import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { _resetSurfaceHealth, surfaceHealthSnapshot, type SurfaceHealthEntry } from '../../kit/lib/surfaceHealth'
import { largeDiffFiles, largeDiffSource } from '../../testkit/largeDiff'
import { installDiffLayout, type DiffLayoutModel } from './layout.helper'
import type { DiffSource } from './source'

// The reader's place through dynamic-block resizes (./diffLayout.ts), against the real pane and the
// generated fixture. The geometry is ./layout.helper.ts's model: a 600px viewport whose scrollTop
// clamps, blocks as tall as the test says, and a ResizeObserver that reports when the test says the
// browser would. Momentum, fractional pixels and paint are the real window's to check.

vi.mock('../../infra/highlight/worker', () => {
  const tokenizeDocument = async (_path: string, code: string) => code.split('\n').map((line) => [{ content: line, light: '', dark: '' }])
  return { tokenizeDocument, highlightDocument: async (path: string, code: string) => ({ lines: await tokenizeDocument(path, code), timedOut: false }) }
})

const { DiffPane } = await import('./DiffPane')

let layout: DiffLayoutModel
let host: HTMLElement
let dispose: (() => void) | undefined

beforeEach(() => {
  layout = installDiffLayout()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  layout()
  _resetSurfaceHealth()
})

const mount = (source: DiffSource = largeDiffSource([...largeDiffFiles('small', 1)])) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <QueryClientProvider client={client}><DiffPane source={source} /></QueryClientProvider>, host)
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))
const scroller = () => host.querySelector<HTMLElement>('.diff')!
const health = (): SurfaceHealthEntry => surfaceHealthSnapshot().surfaces.find((entry) => entry.kind === 'diff')!

type Mounted = { element: HTMLElement; index: number; start: number }
const mounted = (): Mounted[] => [...host.querySelectorAll<HTMLElement>('.diff-item')]
  .map((element) => ({ element, index: Number(element.dataset.index), start: parseFloat(/translateY\(([-\d.]+)px\)/.exec(element.style.transform)?.[1] ?? '0') }))
  .sort((a, b) => a.index - b.index)
const itemOf = (element: Element) => mounted().find((item) => item.element.contains(element))!
const itemAfter = (item: Mounted) => mounted().find((candidate) => candidate.index === item.index + 1)

/** The item the viewport starts in, and how far down the viewport its top sits. */
const anchor = () => {
  const top = scroller().scrollTop
  const item = mounted().filter((candidate) => candidate.start <= top).at(-1)!
  return { index: item.index, edge: item.start - top }
}

/** Move the view with no reader input behind it, and say so the way a browser would. */
const place = async (top: number) => {
  scroller().scrollTop = top
  scroller().dispatchEvent(new Event('scroll'))
  await settle()
}

/** The reader scrolling: input, then the scroll it causes. */
const readerScroll = (by: number) => {
  scroller().dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
  scroller().scrollTop += by
  scroller().dispatchEvent(new Event('scroll'))
}

const resize = (id: string, height: number) => {
  layout.heights.set(id, height)
  layout.resize((element) => (element as HTMLElement).dataset.block === id)
}

/** Scroll down a screen at a time until `pick` finds something among what is mounted. */
async function scan<T>(pick: () => T | undefined): Promise<T> {
  await vi.waitFor(() => expect(host.querySelector('.diff-item .diff-row')).not.toBeNull(), { timeout: 5_000 })
  for (let top = 0; top < 200_000; top += 600) {
    await place(top)
    const found = pick()
    if (found) return found
  }
  throw new Error('nothing in the fixture matched')
}

/** A mounted thread whose item has a mounted item after it, no further than `span` on. */
const findThread = (span = Infinity) => scan(() => [...host.querySelectorAll<HTMLElement>('[data-block^="t:"]')].find((element) => {
  const item = itemOf(element)
  const next = itemAfter(item)
  return item.start > 1_000 && next && next.start - item.start < span
}))

/** Put the viewport 200px below the end of the thread's item, so the thread is wholly above it. */
async function threadAbove(): Promise<{ thread: HTMLElement; id: string }> {
  const thread = await findThread()
  const id = thread.dataset.block!
  await place(itemAfter(itemOf(thread))!.start + 200)
  await settle()
  return { thread, id }
}

describe('the diff reading place', () => {
  it('keeps the same row under the reader when a thread above them grows', async () => {
    mount()
    const { id } = await threadAbove()
    const before = anchor()
    const top = scroller().scrollTop
    const corrections = health().correction.count

    resize(id, 400)

    // The default modelled thread is 120 tall; the reader moved down by exactly what it grew.
    expect(scroller().scrollTop).toBeCloseTo(top + 280, 0)
    expect(anchor().index).toBe(before.index)
    expect(anchor().edge).toBeCloseTo(before.edge, 0)
    expect(health().correction.count).toBe(corrections + 1)
    expect(health().correction.maxAnchorDrift).toBeLessThan(1)
  }, 30_000)

  it('leaves the reader alone when a thread below them grows, and moves what follows it', async () => {
    mount()
    // Short enough that the item after it is still mounted with the thread's item below the viewport.
    const thread = await findThread(600)
    const id = thread.dataset.block!
    await place(itemOf(thread).start - 650)
    const top = scroller().scrollTop
    const nextStart = itemAfter(itemOf(thread))!.start

    resize(id, 200)

    expect(scroller().scrollTop).toBe(top)
    expect(itemAfter(itemOf(thread))!.start).toBeCloseTo(nextStart + 80, 0)
  }, 30_000)

  it('opening a composer moves what follows once, in one commit', async () => {
    const source = { ...largeDiffSource([...largeDiffFiles('small', 1)]), canComment: () => true, addComment: async () => {} }
    mount(source)
    // A line with nothing under it yet, in an item that starts on screen, with an item after it.
    const button = await scan(() => [...host.querySelectorAll<HTMLElement>('.diff-item .diff-row .diff-add-btn')].find((candidate) => {
      const item = itemOf(candidate)
      const top = scroller().scrollTop
      return !candidate.closest('.diff-row')!.querySelector('.diff-line-extra') && item.start >= top && item.start < top + 400 && itemAfter(item)
    }))
    const next = itemAfter(itemOf(button))!
    const nextStart = next.start
    const commits = health().measurement.commits
    const moves: string[] = []
    const watch = new MutationObserver(() => moves.push(next.element.style.transform))
    watch.observe(next.element, { attributes: true, attributeFilter: ['style'] })

    button.click()
    await vi.waitFor(() => expect(host.querySelector('.diff-composer')?.closest('[data-block]')).not.toBeNull(), { timeout: 5_000 })
    // Wait for the commit itself, since a loaded CI runner can take longer than one settle to make
    // it. The settle after it gives a second commit time to show up.
    await vi.waitFor(() => expect(health().measurement.commits).toBeGreaterThan(commits), { timeout: 5_000 })
    await settle()
    watch.disconnect()

    // The modelled composer row is 20 taller than its line: one commit, one move, by that much.
    expect(health().measurement.commits).toBe(commits + 1)
    expect(moves).toEqual([`translateY(${nextStart + 20}px)`])
    expect(health().measurement.maxCommitsInFrame).toBe(1)
  }, 30_000)

  it('holds a correction back while the reader scrolls, and makes it once they stop', async () => {
    mount()
    const { id } = await threadAbove()
    readerScroll(10)
    const before = anchor()
    const top = scroller().scrollTop
    const corrections = health().correction.count

    resize(id, 400)
    // Mid-gesture: the reader is not moved.
    expect(scroller().scrollTop).toBe(top)
    expect(health().correction.count).toBe(corrections)

    await vi.waitFor(() => expect(health().correction.count).toBe(corrections + 1), { timeout: 2_000 })
    expect(scroller().scrollTop).toBeCloseTo(top + 280, 0)
    expect(anchor().index).toBe(before.index)
    expect(anchor().edge).toBeCloseTo(before.edge, 0)
  }, 30_000)

  it('does not count its own correction scrolling as the reader', async () => {
    mount()
    const { id } = await threadAbove()
    resize(id, 400)
    const corrections = health().correction.count
    // The correction's own scroll event, echoing back.
    scroller().dispatchEvent(new Event('scroll'))
    await settle(20)

    resize(id, 150)
    // Answered in the next frame, not held back as if the reader were scrolling.
    await vi.waitFor(() => expect(health().correction.count).toBe(corrections + 1), { timeout: 100 })
  }, 30_000)

  it('lands on the file header when the item the reader was in goes away', async () => {
    mount()
    await vi.waitFor(() => expect(host.querySelector('.diff-item .diff-row')).not.toBeNull(), { timeout: 5_000 })
    // Somewhere inside a file, below its header.
    await place(2_500)
    const inside = mounted().filter((item) => item.start <= 2_500).at(-1)!
    expect(inside.element.dataset.kind).not.toBe('file')
    await vi.waitFor(() => expect(host.querySelector('.diff-sticky-file .diff-file-collapse')).not.toBeNull(), { timeout: 5_000 })
    const path = host.querySelector('.diff-sticky-file .diff-file-path')!.textContent!

    host.querySelector<HTMLElement>('.diff-sticky-file .diff-file-collapse')!.click()
    await settle()

    const header = mounted().find((item) => item.element.dataset.kind === 'file' && item.element.textContent?.includes(path))!
    expect(header.start).toBeCloseTo(scroller().scrollTop, 0)
    expect(health().correction.substituted).toBeGreaterThan(0)
  }, 30_000)

  it('keeps the place through a width change that resizes every block, with scroll events firing', async () => {
    mount()
    const { thread } = await threadAbove()
    const before = anchor()
    const rebuilds = health().measurement.fixedRebuilds
    const grown = new Set<string>()
    for (const element of host.querySelectorAll<HTMLElement>('[data-block]')) {
      layout.heights.set(element.dataset.block!, element.dataset.block!.startsWith('t:') ? 260 : 60)
      grown.add(element.dataset.block!)
    }

    layout.resize()
    // A resize can make the browser scroll too, with nobody touching anything.
    scroller().dispatchEvent(new Event('scroll'))
    await settle()
    scroller().dispatchEvent(new Event('scroll'))
    await settle()

    expect(grown.has(thread.dataset.block ?? '')).toBe(true)
    expect(anchor().index).toBe(before.index)
    expect(anchor().edge).toBeCloseTo(before.edge, 0)
    // Every block changed height, and the fixed geometry was not rebuilt for any of them.
    expect(health().measurement.fixedRebuilds).toBe(rebuilds)
  }, 30_000)
})
