import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dehydrate, QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { segmentContentKey, type DiffDocumentFile, type DiffSegmentRequest } from '@acorn/diff-document/document'
import type { DiffThread } from '../../kit/diff/diffModel'
import { _resetSurfaceHealth, surfaceHealthSnapshot } from '../../kit/lib/telemetry/surfaceHealth'
import { shouldPersistQuery } from '../../infra/persistence/queryPersistence'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { commandRegistry } from '../../host/registries/commands/commands'
import { largeDiffFiles, largeDiffSource, type LargeDiffFile } from '../../testkit/largeDiff'
import { installDiffLayout } from './layout.helper'
import { residentKey, segmentCacheFor } from './segmentCache'
import type { DiffSource } from './source'

// The viewer against the generated fixture, with the source playing the node's part in-process
// (testkit/largeDiff.ts). What is counted is what the viewer asks the source for, because that is
// where a document-sized cost would show: a pane that drained its document would ask for every
// segment.
//
// jsdom has no layout, so ./layout.helper.ts models one.

const tokenizer = vi.hoisted(() => ({ calls: 0, hold: false, timedOut: false, waiting: [] as (() => void)[] }))
vi.mock('../../infra/highlight/worker', () => {
  const tokenizeDocument = async (_path: string, code: string) => {
    tokenizer.calls++
    if (tokenizer.hold) await new Promise<void>((resolve) => tokenizer.waiting.push(resolve))
    return code.split('\n').map((line) => [{ content: line, light: '#111', dark: '#eee' }])
  }
  return { tokenizeDocument, highlightDocument: async (path: string, code: string) => ({ lines: await tokenizeDocument(path, code), timedOut: tokenizer.timedOut }) }
})

const { DiffPane } = await import('./DiffPane')

const cleanups: (() => void)[] = []

beforeEach(() => {
  cleanups.push(installDiffLayout())
})

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  tokenizer.calls = 0
  tokenizer.hold = false
  tokenizer.timedOut = false
  tokenizer.waiting.splice(0).forEach((resolve) => resolve())
  _resetSurfaceHealth()
})

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })

const mount = (source: DiffSource, client = newClient()) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => (
    <QueryClientProvider client={client}><DiffPane source={source} /></QueryClientProvider>
  ), host)
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    dispose()
    host.remove()
  }
  cleanups.push(unmount)
  return Object.assign(host, { client, unmount })
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))

const recorded = () => {
  const requests: DiffSegmentRequest[] = []
  return { requests, onLoad: (batch: DiffSegmentRequest[]) => { requests.push(...batch) } }
}

describe('a segmented diff', () => {
  it('paints plain rows before any colour arrives', async () => {
    tokenizer.hold = true
    const files = [...largeDiffFiles('small', 1)]
    const host = mount(largeDiffSource(files))
    await vi.waitFor(() => expect(host.querySelectorAll('.diff-item .diff-row .diff-code').length).toBeGreaterThan(10), { timeout: 5_000 })
    // The rows are on screen with their text and no token colour, and the tokenizer is still waiting.
    expect(tokenizer.waiting.length).toBeGreaterThan(0)
    const first = host.querySelector<HTMLElement>('.diff-item .diff-row .diff-code span')!
    expect(first.style.getPropertyValue('--l')).toBe('')
    tokenizer.hold = false
    tokenizer.waiting.splice(0).forEach((resolve) => resolve())
    await vi.waitFor(() => expect(host.querySelector<HTMLElement>('.diff-item .diff-row .diff-code span')?.style.getPropertyValue('--l')).toBe('#111'), { timeout: 5_000 })
  })

  it('left open without scrolling, loads and colours only the segments near the viewport', async () => {
    const files = [...largeDiffFiles('scale', 1)]
    const { requests, onLoad } = recorded()
    const source = largeDiffSource(files, { onLoad })
    mount(source)
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0), { timeout: 5_000 })
    await settle(600)
    const total = source.topology()!.totals.segments
    const loaded = new Set(requests.map((request) => `${request.path}:${request.ordinal}`))
    // A window, not the document: the scale fixture has thousands of segments.
    expect(total).toBeGreaterThan(1_000)
    expect(loaded.size).toBeLessThan(40)
    // And nothing is still queued behind them waiting to drain the rest.
    const before = requests.length
    await settle(600)
    expect(requests.length).toBe(before)
    expect(tokenizer.calls).toBeLessThan(200)
  }, 30_000)

  it('jumps from the first file to the last without loading anything in between', async () => {
    const files = [...largeDiffFiles('scale', 1)]
    const { requests, onLoad } = recorded()
    const source = largeDiffSource(files, { onLoad })
    const host = mount(source)
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0), { timeout: 5_000 })
    await settle()
    const last = files[files.length - 1]!
    const middle = new Set(files.slice(20, files.length - 20).map((file) => file.path))
    requests.length = 0
    clientEvents.emit('presentation:file-scroll', { routeKey: 'large-diff', path: last.path })
    host.querySelector('.diff')!.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(requests.some((request) => request.path === last.path || files.slice(-5).some((file) => file.path === request.path))).toBe(true), { timeout: 5_000 })
    expect(requests.filter((request) => middle.has(request.path))).toEqual([])
  }, 30_000)

  it('keeps unchanged segments across a revision and reloads only the file that moved', async () => {
    const files = [...largeDiffFiles('small', 1)].slice(0, 3)
    const { requests, onLoad } = recorded()
    const [current, setCurrent] = createSignal(largeDiffSource(files, { onLoad }))
    const moved: LargeDiffFile = { ...files[0]!, patch: files[0]!.patch!.replace(/compute/, 'MOVED') }
    const next = largeDiffSource([moved, ...files.slice(1)], { onLoad })
    const source: DiffSource = {
      ...current(),
      topology: () => current().topology(),
      loadSegments: (batch, signal) => current().loadSegments(batch, signal),
      search: (request, signal) => current().search(request, signal),
      signature: () => 'same-files',
    }
    const host = mount(source)
    await vi.waitFor(() => expect(host.textContent).toContain('compute'), { timeout: 5_000 })
    await settle()
    const cache = segmentCacheFor(host.client)
    const held = (file: DiffDocumentFile) => file.segments.filter((_, ordinal) => cache.has(residentKey(segmentContentKey(file.patchKey!, ordinal), file.path, file.sha))).length
    const [before, other] = current().topology()!.files
    expect(held(before!)).toBeGreaterThan(0)
    const otherHeld = held(other!)
    // A poll that found nothing new: the same revision, so nothing is asked for and nothing goes.
    requests.length = 0
    setCurrent(largeDiffSource(files, { onLoad }))
    await settle()
    expect(requests).toEqual([])
    expect(held(before!)).toBeGreaterThan(0)

    setCurrent(next)
    await vi.waitFor(() => expect(host.textContent).toContain('MOVED'), { timeout: 5_000 })
    // Only the first file's segments were asked for again; the others kept their rows.
    expect(new Set(requests.map((request) => request.path))).toEqual(new Set([moved.path]))
    // And the patch it moved from is gone from the cache, while the other files' stay.
    expect(held(before!)).toBe(0)
    expect(held(other!)).toBe(otherHeld)
  })

  it('finds across the whole document and loads the segment a match is in', async () => {
    const files = [...largeDiffFiles('scale', 1)]
    const { requests, onLoad } = recorded()
    const source = largeDiffSource(files, { onLoad })
    // A word only the last file has, so every match is far from anything loaded.
    const target = files.filter((file) => file.patch).at(-1)!
    const word = 'needleAtTheEnd'
    const patched = files.map((file) => (file === target ? { ...file, patch: file.patch!.replace(/compute/g, word) } : file))
    const withNeedle = largeDiffSource(patched, { onLoad })
    const host = mount({ ...source, ...withNeedle })
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0), { timeout: 5_000 })
    ;(commandRegistry.get('large-diff.find') as unknown as { run: () => void }).run()
    await vi.waitFor(() => expect(host.querySelector('[role="search"] input')).not.toBeNull(), { timeout: 5_000 })
    const input = host.querySelector<HTMLInputElement>('[role="search"] input')!
    input.value = word
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(requests.some((request) => request.path === target.path)).toBe(true), { timeout: 5_000 })
    host.querySelector('.diff')!.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(host.querySelector('.ui-find-mark')?.textContent).toBe(word), { timeout: 5_000 })
  }, 30_000)

  it('filters the files by name and marks where each one matched', async () => {
    const files = [...largeDiffFiles('small', 1)].slice(0, 3)
    const host = mount(largeDiffSource(files))
    const heads = () => [...host.querySelectorAll('.diff-item .diff-file-path')].map((head) => head.textContent)
    await vi.waitFor(() => expect(heads()[0]).toBe(files[0]!.path), { timeout: 5_000 })
    // The last file, so it is the first header only if the two before it were filtered out.
    const target = files[2]!.path
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Filter files"]')!
    input.value = target
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(heads()).toEqual([target]), { timeout: 5_000 })
    expect(host.querySelector('.diff-item .diff-file-path .ui-find-mark')?.textContent).toBe(target)
  }, 20_000)

  it('expands a gap into context rows and collapses a file to its header', async () => {
    const files = [...largeDiffFiles('small', 1)].slice(0, 2)
    const host = mount(largeDiffSource(files))
    await vi.waitFor(() => expect(host.querySelector('.diff-gap')).not.toBeNull(), { timeout: 5_000 })
    host.querySelector<HTMLButtonElement>('.diff-gap:not(:disabled)')!.click()
    await vi.waitFor(() => expect(host.querySelector('.diff-item[data-kind="overlay"] .diff-row')).not.toBeNull(), { timeout: 5_000 })

    const collapse = host.querySelector<HTMLButtonElement>('.diff-item .diff-file-collapse')!
    collapse.click()
    await vi.waitFor(() => expect(host.querySelector('.diff-item .diff-file-collapse')?.getAttribute('aria-expanded')).toBe('false'), { timeout: 5_000 })
    const firstFile = files[0]!.path
    const items = [...host.querySelectorAll<HTMLElement>('.diff-item')]
    const headers = items.filter((item) => item.querySelector('.diff-file-head'))
    expect(headers[0]!.textContent).toContain(firstFile)
    // The next item after the collapsed file's header is the second file's header.
    const next = items.sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))[1]
    expect(next?.textContent).toContain(files[1]!.path)
  }, 20_000)
})

describe('resident segments', () => {
  const diff = () => surfaceHealthSnapshot().surfaces.find((entry) => entry.kind === 'diff')

  it('paints a revisited diff from memory, coloured, before any segment request answers', async () => {
    const files = [...largeDiffFiles('small', 1)]
    const first = mount(largeDiffSource(files))
    await vi.waitFor(() => expect(first.querySelector<HTMLElement>('.diff-item .diff-row .diff-code span')?.style.getPropertyValue('--l')).toBe('#111'), { timeout: 5_000 })
    await settle()
    first.unmount()

    // The same node, a new pane, and a source that never answers: whatever it draws came from memory.
    const { requests, onLoad } = recorded()
    const calls = tokenizer.calls
    const again = mount(largeDiffSource(files, { onLoad, delay: () => new Promise(() => {}) }), first.client)
    await vi.waitFor(() => expect(again.querySelectorAll('.diff-item .diff-row .diff-code').length).toBeGreaterThan(10), { timeout: 5_000 })
    expect(again.querySelector<HTMLElement>('.diff-item .diff-row .diff-code span')!.style.getPropertyValue('--l')).toBe('#111')
    expect(tokenizer.calls).toBe(calls)
    const reading = diff()!
    expect(reading.resident.hits).toBeGreaterThan(0)
    expect(reading.resident.rows).toBeLessThanOrEqual(reading.resident.rowCeiling)
    expect(reading.resident.estimatedBytes).toBeLessThanOrEqual(reading.resident.byteCeiling)
    // Anything it did ask for is beyond what it had held, never a segment it drew.
    const drawn = new Set([...again.querySelectorAll<HTMLElement>('.diff-item[data-kind="segment"]')].map((item) => item.dataset.key))
    expect(requests.filter((request) => drawn.has(`s:${request.path}:${request.ordinal}`))).toEqual([])
  }, 20_000)

  it('draws colour a timeout decided, and colours it again on the next visit', async () => {
    const files = [...largeDiffFiles('small', 1)]
    tokenizer.timedOut = true
    const first = mount(largeDiffSource(files))
    await vi.waitFor(() => expect(first.querySelector<HTMLElement>('.diff-item .diff-row .diff-code span')?.style.getPropertyValue('--l')).toBe('#111'), { timeout: 5_000 })
    await settle()
    // The pane that fell back does not try again while it is open.
    const stalled = tokenizer.calls
    await settle()
    expect(tokenizer.calls).toBe(stalled)
    first.unmount()

    tokenizer.timedOut = false
    const again = mount(largeDiffSource(files), first.client)
    await vi.waitFor(() => expect(tokenizer.calls).toBeGreaterThan(stalled), { timeout: 5_000 })
    await settle()
    const cache = segmentCacheFor(again.client)
    const coloured = largeDiffSource(files).topology()!.files.flatMap((file) => file.segments
      .map((_, ordinal) => cache.peek(residentKey(segmentContentKey(file.patchKey!, ordinal), file.path, file.sha)))
      .filter((entry) => entry?.enriched))
    expect(coloured.length).toBeGreaterThan(0)
    expect(coloured.every((entry) => entry!.provisional === false)).toBe(true)
  }, 20_000)

  it('shares nothing between two nodes', async () => {
    const files = [...largeDiffFiles('small', 1)]
    const first = mount(largeDiffSource(files))
    await vi.waitFor(() => expect(first.querySelectorAll('.diff-item .diff-row').length).toBeGreaterThan(10), { timeout: 5_000 })
    first.unmount()
    const { requests, onLoad } = recorded()
    mount(largeDiffSource(files, { onLoad }))
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0), { timeout: 5_000 })
  })

  it('keeps code rows when a thread resolves, and asks for nothing', async () => {
    const files = [...largeDiffFiles('small', 1)]
    const own = files.flatMap((file) => file.threads)
    const [threads, setThreads] = createSignal<DiffThread[]>(own)
    const { requests, onLoad } = recorded()
    const host = mount(largeDiffSource(files, { onLoad, threads }))
    await vi.waitFor(() => expect(host.querySelectorAll('.diff-item .diff-row').length).toBeGreaterThan(10), { timeout: 5_000 })
    await settle()
    const cache = segmentCacheFor(host.client)
    const { inserts, evictions } = cache.stats()
    requests.length = 0
    setThreads(own.map((thread) => ({ ...thread, resolved: !thread.resolved })))
    await settle()
    expect(requests).toEqual([])
    expect(cache.stats()).toMatchObject({ inserts, evictions })
  })

  it('never puts a segment into the persisted query snapshot', async () => {
    const CANARY = 'CANARY9d2e'
    const files = [...largeDiffFiles('small', 1)].map((file): LargeDiffFile => ({ ...file, patch: file.patch?.replace(/compute/g, `compute_${CANARY}`) ?? null }))
    const host = mount(largeDiffSource(files))
    await vi.waitFor(() => expect(host.textContent).toContain(CANARY), { timeout: 5_000 })
    host.client.setQueryData(['tasks'], [{ id: 'kept' }])
    const snapshot = JSON.stringify(dehydrate(host.client, { shouldDehydrateQuery: shouldPersistQuery }))
    expect(snapshot).toContain('kept')
    expect(snapshot).not.toContain(CANARY)
  })
})
