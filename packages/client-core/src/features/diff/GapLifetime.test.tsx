import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import { DiffPane } from './DiffPane'
import type { DiffCanvas } from './DiffCanvas'
import type { DiffSource } from './source'
import { documentTopology, fileDocument, type DiffDocumentFile, type DiffSegmentPayload } from '@acorn/diff-document/document'
import { installDiffLayout } from './layout.helper'
import type { LineComposerController } from '../../kit/diff/DiffRows'
import type { GapRow, Row } from '../../kit/diff/diffModel'

const observed = vi.hoisted(() => ({ canvas: null as Parameters<typeof DiffCanvas>[0] | null, tokenize: vi.fn(async (_path: string, code: string) =>
  code.split('\n').map((content) => [{ content, light: '', dark: '' }])) }))
vi.mock('./DiffCanvas', () => ({ DiffCanvas: (props: unknown) => { observed.canvas = props as Parameters<typeof DiffCanvas>[0]; return null } }))
vi.mock('../../infra/highlight/worker', () => ({ tokenizeDocument: observed.tokenize, highlightDocument: async (path: string, code: string) => ({ lines: await observed.tokenize(path, code), timedOut: false }) }))
vi.mock('../../infra/highlight/wordDiffWorker', () => ({ diffWordsDocument: async () => [] }))
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); observed.tokenize.mockClear() })
const deferred = <T,>() => { let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes }); return { promise, resolve } }
const acknowledge = (composer: LineComposerController, body: string) => {
  expect(composer.acknowledge).toBeTypeOf('function')
  composer.acknowledge!(body)
}
const documentFor = (path: string) => fileDocument(path, '@@ -3,1 +3,1 @@\n-old\n+new\n')
function mount(read: (input: { path: string; sha: string }) => Promise<string>) {
  cleanups.push(installDiffLayout())
  const [signature, setSignature] = createSignal('A')
  const [keys, setKeys] = createSignal({ 'a.ts': 'A', 'b.ts': 'A' })
  const [showA, setShowA] = createSignal(true)
  const topology = () => documentTopology((showA() ? ['a.ts', 'b.ts'] : ['b.ts']).map((path): DiffDocumentFile => ({
    path, status: 'modified', additions: 1, deletions: 1, sha: 'working', viewed: false,
    patchKey: `${path}:${keys()[path as 'a.ts' | 'b.ts']}`, segments: documentFor(path).descriptors,
  })))
  const source: DiffSource = { scope: { routeKey: 'gap-lifetime' }, topology, signature,
    loadSegments: async requests => requests.map((request): DiffSegmentPayload => ({ ...request, rows: documentFor(request.path).segments[request.ordinal]! })),
    search: async () => ({ matches: [], nextCursor: null }),
    loading: () => false, selectedPath: () => '', fileText: read, canComment: () => false,
    invalidate: () => {}, draftPrefix: 'gap-lifetime', find: { commandId: 'gap.find', description: 'Find', category: 'test' } }
  const [present, setPresent] = createSignal(source)
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => <QueryClientProvider client={client}><DiffPane source={present()} /></QueryClientProvider>, host)
  const cleanup = () => { dispose(); host.remove(); client.clear() }; cleanups.push(cleanup)
  const rows = (): Row[] => observed.canvas!.items().flatMap(item => item.kind === 'segment' || item.kind === 'overlay' ? [...(observed.canvas!.itemRows(item) ?? [])] : [])
  const top = (path = 'a.ts') => rows().find((r): r is GapRow => r.kind === 'gap' && r.side === 'top' && r.path === path)
  return { setSignature, setKeys, setShowA, changeSource: () => setPresent({ ...source, draftPrefix: 'other-draft-origin', scope: { routeKey: 'other-origin' } }), restoreSource: () => setPresent(source), dispose: cleanup,
    rows, top, expand: (path = 'a.ts') => observed.canvas!.rows.expandGap(top(path)!) }
}
it.each(['signature', 'content', 'source'] as const)('fences a held body across %s A to B to A', async (kind) => {
  const body = deferred<string>(); const pane = mount(() => body.promise)
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  const pending = pane.expand(); const before = observed.tokenize.mock.calls.length
  if (kind === 'signature') { pane.setSignature('B'); pane.setSignature('A') }
  else if (kind === 'source') { pane.changeSource(); pane.restoreSource() }
  else { pane.setKeys({ 'a.ts': 'B', 'b.ts': 'A' }); pane.setKeys({ 'a.ts': 'A', 'b.ts': 'A' }) }
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  body.resolve('obsolete one\nobsolete two\nnew'); await pending
  expect(observed.tokenize.mock.calls.slice(before).some((call) => call[1].includes('obsolete'))).toBe(false)
  expect(pane.rows().some((r) => 'raw' in r && r.raw.startsWith('obsolete'))).toBe(false)
})
it('fences a held gap body when the same file disappears and returns', async () => {
  const body = deferred<string>(); const pane = mount(() => body.promise)
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  const pending = pane.expand(); const before = observed.tokenize.mock.calls.length
  pane.setShowA(false); pane.setShowA(true)
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  body.resolve('obsolete one\nobsolete two\nnew'); await pending
  expect(observed.tokenize.mock.calls.slice(before).some(call => call[1].includes('obsolete'))).toBe(false)
  expect(pane.rows().some(row => 'raw' in row && row.raw.startsWith('obsolete'))).toBe(false)
})
it('fences completion after tokenization has started while retaining an unchanged sibling expansion', async () => {
  const pane = mount(async () => 'context one\ncontext two\nnew')
  await vi.waitFor(() => expect(pane.top('b.ts')).toBeDefined())
  await pane.expand('b.ts')
  const tokens = deferred<{ content: string; light: string; dark: string }[][]>()
  let tokenizing = false
  observed.tokenize.mockImplementationOnce(async () => { tokenizing = true; return tokens.promise })
  const pending = pane.expand('a.ts')
  await vi.waitFor(() => expect(tokenizing).toBe(true))
  pane.setKeys({ 'a.ts': 'B', 'b.ts': 'A' })
  tokens.resolve([[{ content: 'obsolete', light: '', dark: '' }]]); await pending
  await vi.waitFor(() => expect(pane.top('a.ts')).toBeDefined()); expect(pane.top('b.ts')).toBeUndefined()
  expect(pane.rows().filter((r) => 'path' in r && r.path === 'b.ts' && 'raw' in r && r.raw.startsWith('context'))).toHaveLength(2)
})
it('invalidates only the changed file and permits a failed read to retry', async () => {
  let fail = false; const pane = mount(async () => { if (fail) throw new Error('fixture'); return 'context one\ncontext two\nnew' })
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  await pane.expand('a.ts'); await pane.expand('b.ts')
  pane.setKeys({ 'a.ts': 'B', 'b.ts': 'A' })
  await vi.waitFor(() => expect(pane.top('a.ts')).toBeDefined()); expect(pane.top('b.ts')).toBeUndefined()
  fail = true; await pane.expand('a.ts'); expect(pane.top('a.ts')).toBeDefined()
  fail = false; await pane.expand('a.ts'); expect(pane.top('a.ts')).toBeUndefined()
})


it('keeps the active successor slot and captured draft namespace during acknowledgement cleanup', async () => {
  const pane = mount(async () => 'context one\ncontext two\nnew')
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  const first = observed.canvas!.rows.composerFor('first')
  first.setOpen(true); first.setBody('old draft')
  const next = observed.canvas!.rows.composerFor('next')
  next.setOpen(true); next.setBody('successor draft')
  acknowledge(first, 'old draft')
  expect(next.isOpen()).toBe(true); expect(next.body()).toBe('successor draft')
  pane.changeSource()
  const replacement = observed.canvas!.rows.composerFor('first')
  replacement.setOpen(true); replacement.setBody('replacement source draft')
  acknowledge(first, 'old draft')
  expect(replacement.isOpen()).toBe(true); expect(replacement.body()).toBe('replacement source draft')
  pane.restoreSource()
  const acknowledged = observed.canvas!.rows.composerFor('first'); acknowledged.setOpen(true)
  expect(acknowledged.body()).toBe('')
})


it('acknowledges only exact original text and preserves edits to the same draft key', async () => {
  const pane = mount(async () => 'context one\ncontext two\nnew')
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  const submitting = observed.canvas!.rows.composerFor('same-key')
  submitting.setOpen(true); submitting.setBody(' original body ')
  const successor = observed.canvas!.rows.composerFor('same-key')
  successor.setBody(' original body plus edit ')
  acknowledge(submitting, ' original body ')
  expect(successor.isOpen()).toBe(true); expect(successor.body()).toBe(' original body plus edit ')
  successor.setOpen(false); successor.setOpen(true)
  expect(successor.body()).toBe(' original body plus edit ')
  acknowledge(submitting, ' original body plus edit ')
  expect(successor.isOpen()).toBe(false); successor.setOpen(true); expect(successor.body()).toBe('')
})
