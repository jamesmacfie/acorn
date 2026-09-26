import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { DiffSegmentRequest } from '@acorn/diff-document/document'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { commandRegistry } from '../../host/registries/commands/commands'
import { largeDiffFiles, largeDiffSource, type LargeDiffFile } from '../../testkit/largeDiff'
import { installDiffLayout } from './layout.helper'
import type { DiffSource } from './source'

// The viewer against the generated fixture, with the source playing the node's part in-process
// (testkit/largeDiff.ts). What is counted is what the viewer asks the source for, because that is
// where a document-sized cost would show: a pane that drained its document would ask for every
// segment.
//
// jsdom has no layout, so ./layout.helper.ts models one.

const tokenizer = vi.hoisted(() => ({ calls: 0, hold: false, waiting: [] as (() => void)[] }))
vi.mock('../../infra/highlight/worker', () => ({
  tokenizeDocument: async (_path: string, code: string) => {
    tokenizer.calls++
    if (tokenizer.hold) await new Promise<void>((resolve) => tokenizer.waiting.push(resolve))
    return code.split('\n').map((line) => [{ content: line, light: '#111', dark: '#eee' }])
  },
}))

const { DiffPane } = await import('./DiffPane')

const cleanups: (() => void)[] = []

beforeEach(() => {
  cleanups.push(installDiffLayout())
})

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  tokenizer.calls = 0
  tokenizer.hold = false
  tokenizer.waiting.splice(0).forEach((resolve) => resolve())
})

const mount = (source: DiffSource) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(() => (
    <QueryClientProvider client={client}><DiffPane source={source} /></QueryClientProvider>
  ), host))
  cleanups.push(() => host.remove())
  return host
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
    requests.length = 0
    setCurrent(next)
    await vi.waitFor(() => expect(host.textContent).toContain('MOVED'), { timeout: 5_000 })
    // Only the first file's segments were asked for again; the others kept their rows.
    expect(new Set(requests.map((request) => request.path))).toEqual(new Set([moved.path]))
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
    await vi.waitFor(() => expect(host.querySelector('input')).not.toBeNull(), { timeout: 5_000 })
    const input = host.querySelector('input')!
    input.value = word
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(requests.some((request) => request.path === target.path)).toBe(true), { timeout: 5_000 })
    host.querySelector('.diff')!.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(host.querySelector('.ui-find-mark')?.textContent).toBe(word), { timeout: 5_000 })
  }, 30_000)

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
