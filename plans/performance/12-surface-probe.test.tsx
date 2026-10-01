// Actual host document surface; synthetic read/write transport. No paid provider or private content.
import { render } from 'solid-js/web'
import { afterEach, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { EditorView } from '@codemirror/view'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DocumentHandle } from '../../packages/client-core/src/features/editor/documentModel'

Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
const api = vi.hoisted(() => ({ write: vi.fn(async (_path: string, _options: any) => ({})) }))
vi.mock('../../packages/client-core/src/infra/node/apiClient', () => ({ readJson: async () => ({ text: 'baseline\n' }), writeJson: api.write }))
const { default: DocumentSurface } = await import('../../packages/client-core/src/features/editor/DocumentSurface')
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const record = (name: string, value: unknown) => {
  const path = join(dirname(fileURLToPath(import.meta.url)), `12-${name}-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists; use a new tag.')
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); api.write.mockReset().mockResolvedValue({}) })
async function mount() {
  const qc = new QueryClient()
  const host = document.createElement('div'); document.body.append(host)
  let handle: DocumentHandle | null = null
  const stop = render(() => <QueryClientProvider client={qc}><DocumentSurface pluginId="synthetic" surfaceId="scratch" nodeId="node-a"
    region={{ languageId: 'plaintext', read: '/v1/p/synthetic/tasks/:taskId/doc', write: '/v1/p/synthetic/tasks/:taskId/doc' } as any}
    scope={{ taskId: 'synthetic-task' }} onHandle={value => { handle = value }} /></QueryClientProvider>, host)
  cleanups.push(() => { stop(); host.remove(); qc.clear() })
  const view = await vi.waitFor(() => {
    const dom = host.querySelector<HTMLElement>('.cm-editor'); const value = dom && EditorView.findFromDOM(dom)
    if (!value || !handle) throw new Error('Surface is not ready')
    return value
  })
  return { view, handle: handle!, host, stop }
}

it('records flush during an already pending identical save', async () => {
  const { view, handle } = await mount()
  let release!: () => void, acknowledged = false
  api.write.mockImplementationOnce(() => new Promise(resolve => { release = () => { acknowledged = true; resolve({}) } }))
  view.dispatch({ changes: { from: 0, insert: 'LATEST\n' } })
  const first = handle.flush()
  let secondSettled = false
  const second = handle.flush().then(() => { secondSettled = true })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  const beforeAck = { secondSettled, acknowledged, writes: api.write.mock.calls.length }
  release(); await Promise.all([first, second])
  record('surface-flush-pending', { fixture: 'actual DocumentHandle.flush; two flush calls, first write held', beforeAck,
    targetNode: api.write.mock.calls[0]?.[1].nodeId, expected: 'Both flush promises remain pending until the current snapshot has been acknowledged.' })
})

it('records whether a failed surface flush reports failure', async () => {
  const { view, handle, host } = await mount()
  api.write.mockRejectedValueOnce(new Error('Synthetic offline'))
  view.dispatch({ changes: { from: 0, insert: 'UNSENT\n' } })
  const flush = await handle.flush().then(() => 'resolved', () => 'rejected')
  record('surface-flush-failed', { fixture: 'actual DocumentHandle.flush with failed write', flush, visible: view.state.doc.toString(), errorVisible: host.textContent?.includes('Synthetic offline'),
    expected: 'flush rejects failure so execute/surfaceAction does not run on the stale saved document; unsent text survives teardown for retry.' })
})
