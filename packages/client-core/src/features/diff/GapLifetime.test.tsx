import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import { DiffPane } from './DiffPane'
import type { DiffFile, GapRow, Row } from '../../kit/diff/diffModel'

const observed = vi.hoisted(() => ({ canvas: null as any, tokenize: vi.fn(async (_path: string, code: string) =>
  code.split('\n').map((content) => [{ content, light: '', dark: '' }])) }))
vi.mock('./DiffCanvas', () => ({ DiffCanvas: (props: unknown) => { observed.canvas = props; return null } }))
vi.mock('../../infra/highlight/worker', () => ({ tokenizeDocument: observed.tokenize }))
vi.mock('../../infra/highlight/wordDiffWorker', () => ({ diffWordsDocument: async () => [] }))
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); observed.tokenize.mockClear() })
const deferred = <T,>() => { let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes }); return { promise, resolve } }
const file = (path: string): DiffFile => ({ path, status: 'modified', additions: 1, deletions: 1,
  sha: 'working', viewed: false, patch: '@@ -3,1 +3,1 @@\n-old\n+new\n' })
function mount(read: (input: { path: string; sha: string }) => Promise<string>) {
  const [signature, setSignature] = createSignal('A')
  const [keys, setKeys] = createSignal({ 'a.ts': 'A', 'b.ts': 'A' })
  const source = { scope: { routeKey: 'gap-lifetime' }, files: () => [file('a.ts'), file('b.ts')], signature,
    contentSignature: () => JSON.stringify(keys()), contentKey: (path: string) => keys()[path as 'a.ts' | 'b.ts'],
    loading: () => false, selectedPath: () => '', cachedFile: () => null, fileText: read, canComment: () => false,
    invalidate: () => {}, draftPrefix: 'gap-lifetime', find: { commandId: 'gap.find', description: 'Find', category: 'test' } }
  const [present, setPresent] = createSignal(source)
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => <QueryClientProvider client={client}><DiffPane source={present()} /></QueryClientProvider>, host)
  const cleanup = () => { dispose(); host.remove(); client.clear() }; cleanups.push(cleanup)
  return { setSignature, setKeys, changeSource: () => setPresent({ ...source, draftPrefix: 'other-draft-origin', scope: { routeKey: 'other-origin' } }), restoreSource: () => setPresent(source), dispose: cleanup,
    rows: (): Row[] => observed.canvas.rows(),
    top: (path = 'a.ts'): GapRow => observed.canvas.rows().find((r: Row) => r.kind === 'gap' && r.side === 'top' && r.path === path),
    expand: (path = 'a.ts') => observed.canvas.expandGap(observed.canvas.rows().find((r: Row) => r.kind === 'gap' && r.side === 'top' && r.path === path)) }
}
it.each(['signature', 'content', 'source'] as const)('fences a held body across %s A to B to A', async (kind) => {
  const body = deferred<string>(); const pane = mount(() => body.promise)
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  const pending = pane.expand(); const before = observed.tokenize.mock.calls.length
  if (kind === 'signature') { pane.setSignature('B'); pane.setSignature('A') }
  else if (kind === 'source') { pane.changeSource(); pane.restoreSource() }
  else { pane.setKeys({ 'a.ts': 'B', 'b.ts': 'A' }); pane.setKeys({ 'a.ts': 'A', 'b.ts': 'A' }) }
  body.resolve('obsolete one\nobsolete two\nnew'); await pending
  expect(observed.tokenize.mock.calls.slice(before).some((call) => call[1].includes('obsolete'))).toBe(false)
  expect(pane.rows().some((r) => 'raw' in r && r.raw.startsWith('obsolete'))).toBe(false)
})
it('fences completion after tokenization has started while retaining an unchanged sibling expansion', async () => {
  const pane = mount(async () => 'context one\ncontext two\nnew')
  await vi.waitFor(() => expect(pane.top('b.ts')).toBeDefined())
  await pane.expand('b.ts')
  const tokens = deferred<{ content: string; light: string; dark: string }[][]>()
  observed.tokenize.mockImplementationOnce(async () => tokens.promise)
  const pending = pane.expand('a.ts')
  await vi.waitFor(() => expect(observed.tokenize.mock.calls.at(-1)?.[0]).toBe('a.ts'))
  pane.setKeys({ 'a.ts': 'B', 'b.ts': 'A' })
  tokens.resolve([[{ content: 'obsolete', light: '', dark: '' }]]); await pending
  expect(pane.top('a.ts')).toBeDefined(); expect(pane.top('b.ts')).toBeUndefined()
  expect(pane.rows().filter((r) => 'path' in r && r.path === 'b.ts' && 'raw' in r && r.raw.startsWith('context'))).toHaveLength(2)
})
it('invalidates only the changed file and permits a failed read to retry', async () => {
  let fail = false; const pane = mount(async () => { if (fail) throw new Error('fixture'); return 'context one\ncontext two\nnew' })
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  await pane.expand('a.ts'); await pane.expand('b.ts')
  pane.setKeys({ 'a.ts': 'B', 'b.ts': 'A' })
  expect(pane.top('a.ts')).toBeDefined(); expect(pane.top('b.ts')).toBeUndefined()
  fail = true; await pane.expand('a.ts'); expect(pane.top('a.ts')).toBeDefined()
  fail = false; await pane.expand('a.ts'); expect(pane.top('a.ts')).toBeUndefined()
})


it('keeps the active successor slot and captured draft namespace during acknowledgement cleanup', async () => {
  const pane = mount(async () => 'context one\ncontext two\nnew')
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  const first = observed.canvas.composerFor('first')
  first.setOpen(true); first.setBody('old draft')
  const next = observed.canvas.composerFor('next')
  next.setOpen(true); next.setBody('successor draft')
  first.acknowledge('old draft')
  expect(next.isOpen()).toBe(true); expect(next.body()).toBe('successor draft')
  pane.changeSource()
  const replacement = observed.canvas.composerFor('first')
  replacement.setOpen(true); replacement.setBody('replacement source draft')
  first.acknowledge('old draft')
  expect(replacement.isOpen()).toBe(true); expect(replacement.body()).toBe('replacement source draft')
  pane.restoreSource()
  const acknowledged = observed.canvas.composerFor('first'); acknowledged.setOpen(true)
  expect(acknowledged.body()).toBe('')
})


it('acknowledges only exact original text and preserves edits to the same draft key', async () => {
  const pane = mount(async () => 'context one\ncontext two\nnew')
  await vi.waitFor(() => expect(pane.top()).toBeDefined())
  const submitting = observed.canvas.composerFor('same-key')
  submitting.setOpen(true); submitting.setBody(' original body ')
  const successor = observed.canvas.composerFor('same-key')
  successor.setBody(' original body plus edit ')
  submitting.acknowledge(' original body ')
  expect(successor.isOpen()).toBe(true); expect(successor.body()).toBe(' original body plus edit ')
  successor.setOpen(false); successor.setOpen(true)
  expect(successor.body()).toBe(' original body plus edit ')
  submitting.acknowledge(' original body plus edit ')
  expect(successor.isOpen()).toBe(false); successor.setOpen(true); expect(successor.body()).toBe('')
})
