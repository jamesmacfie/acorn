import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { DiffPane } from '../../packages/client-core/src/features/diff/DiffPane'
import type { DiffFile, GapRow, Row } from '../../packages/client-core/src/kit/diff/diffModel'

const observed = vi.hoisted(() => ({ canvas: null as any, tokenized: [] as string[] }))
vi.mock('../../packages/client-core/src/features/diff/DiffCanvas', () => ({ DiffCanvas: (props: any) => { observed.canvas = props; return null } }))
vi.mock('../../packages/client-core/src/infra/highlight/worker', () => ({ tokenizeDocument: async (_path: string, code: string) => {
  observed.tokenized.push(code); return code.split('\n').map((content) => [{ content, light: '', dark: '' }])
} }))
vi.mock('../../packages/client-core/src/infra/highlight/wordDiffWorker', () => ({ diffWordsDocument: async () => [] }))
const records: any[] = []
const file = (sha: string): DiffFile => ({ path: 'synthetic.ts', status: 'modified', additions: 1, deletions: 1, sha, viewed: false,
  patch: '@@ -3,1 +3,1 @@\n-old\n+new\n' })

function mount(read: () => Promise<string>) {
  const [files, setFiles] = createSignal([file('A')]); const [signature, setSignature] = createSignal('same-files')
  const [key, setKey] = createSignal('version-A')
  const source = { scope: { routeKey: 'gap-audit' }, files, signature, contentSignature: () => signature() + key(), contentKey: () => key(),
    loading: () => false, selectedPath: () => '', cachedFile: () => null, fileText: read, canComment: () => false, invalidate: () => {}, draftPrefix: 'gap-audit',
    find: { commandId: 'audit.gap.find', description: 'Find', category: 'audit' } }
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => <QueryClientProvider client={client}><DiffPane source={source} /></QueryClientProvider>, host)
  return { dispose: () => { dispose(); host.remove(); client.clear() }, setFiles, setSignature, setKey,
    rows: (): Row[] => observed.canvas.rows(), top: (): GapRow => observed.canvas.rows().find((r: Row) => r.kind === 'gap' && r.side === 'top') }
}
it('a late expansion crosses a changed diff signature with matching gap coordinates', async () => {
  let release!: (text: string) => void
  const mounted = mount(() => new Promise<string>((resolve) => { release = resolve }))
  await vi.waitFor(() => expect(mounted.top()?.sha).toBe('A'))
  const pending = observed.canvas.expandGap(mounted.top())
  mounted.setFiles([file('B')]); mounted.setSignature('different-files')
  await vi.waitFor(() => expect(mounted.top()?.sha).toBe('B'))
  release('OLD_CONTEXT_1\nOLD_CONTEXT_2\nnew\n'); await pending
  const stale = mounted.rows().filter((r: any) => r.raw?.startsWith('OLD_CONTEXT')).length
  records.push({ case: 'old-expansion-after-signature-change', staleRows: stale, activeSha: mounted.rows().find((r) => r.kind === 'file')?.file.sha })
  expect(stale).toBe(2); mounted.dispose()
})
it('a moved content key retains context expanded from the old version', async () => {
  const mounted = mount(async () => 'OLD_CONTEXT_1\nOLD_CONTEXT_2\nnew\n')
  await vi.waitFor(() => expect(mounted.top()?.sha).toBe('A'))
  await observed.canvas.expandGap(mounted.top())
  mounted.setFiles([file('B')]); mounted.setKey('version-B')
  await vi.waitFor(() => expect(mounted.rows().find((r) => r.kind === 'file')?.file.sha).toBe('B'))
  const stale = mounted.rows().filter((r: any) => r.raw?.startsWith('OLD_CONTEXT')).length
  records.push({ case: 'old-expanded-context-after-key-refresh', staleRows: stale, remainingTopGap: !!mounted.top() })
  expect(stale).toBe(2); mounted.dispose()
})
it('disposing the pane does not skip expansion tokenization after its file read', async () => {
  let release!: (text: string) => void
  const mounted = mount(() => new Promise<string>((resolve) => { release = resolve }))
  await vi.waitFor(() => expect(mounted.top()?.sha).toBe('A'))
  const before = observed.tokenized.length
  const pending = observed.canvas.expandGap(mounted.top()); mounted.dispose()
  release('DISPOSED_CONTEXT_1\nDISPOSED_CONTEXT_2\nnew\n'); await pending
  records.push({ case: 'disposed-expansion-still-tokenizes', callsAfterDispose: observed.tokenized.length - before })
  expect(observed.tokenized.length - before).toBe(1)
  writeFileSync(`${process.cwd()}/plans/performance/10-gaps-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, JSON.stringify(records, null, 2) + '\n')
})
