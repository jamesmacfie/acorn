/** @jsxImportSource @acorn/tui/jsx */
import { expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { renderCells } from '../../apps/tui/src/kit/render'
const held = vi.hoisted(() => ({ qc: { getQueryData: () => ({ 'plugin:audit:value': JSON.stringify('cache-a') }) } as any, calls: [] as any[] }))
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => held.qc }))
vi.mock('../../apps/tui/src/plugins/TreeHost', () => ({ TreeHost: () => <text>tree</text> }))
vi.mock('../../packages/client-core/src/infra/node/apiClient', () => ({ sendRaw: async (path: string, options: unknown) => { held.calls.push({ path, options }); return { ok: true, status: 200, body: null } }, sendRawBytes: () => {} }))
vi.mock('../../packages/client-core/src/host/plugins/contributions', () => ({ eligiblePlugins: () => [{ pluginId: 'audit', installed: { permissions: { api: [], events: [] }, contributions: { frames: [] } } }], isTaskPane: () => false }))
import { RemoteTree } from '../../apps/tui/src/plugins/RemoteTree'
import { _setWorkerFactory, _stopAllTreeWorkers } from '../../packages/client-core/src/host/tree/workerHost'
import { setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
class Port { onmessage: ((event: any) => void) | null = null; posted: any[] = []; closed = false; start() {} close() { this.closed = true } postMessage(data: any) { this.posted.push(data) } }
const channels: { port1: Port; port2: Port }[] = []
class Channel { port1 = new Port(); port2 = new Port(); constructor() { channels.push(this) } }
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
it('records the same first-slot document and Node retention in actual TUI RemoteTree', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'; const output = `plans/performance/16-tui-pool-${tag}.json`
  if (tag.startsWith('before') && existsSync(output)) throw new Error('Before exists')
  vi.stubGlobal('MessageChannel', Channel); let spawned = 0, terminated = 0; let a: any, b: any
  _setWorkerFactory(() => { spawned++; return { postMessage() {}, terminate() { terminated++ }, onerror: null } as any })
  const contribution = { pluginId: 'audit', id: 'audit.panel', hash: 'c'.repeat(64), entry: 'panel' }
  try {
    setActiveNode('node-a')
    a = await renderCells(() => <RemoteTree contribution={contribution} props={() => ({ taskId: 'task-a' })} scope={() => ({ taskId: 'task-a' })} document={() => ({ read: () => 'document-a', write() {}, flush: async () => {} })} />, { width: 80, height: 24 })
    const bridge = channels[0]!.port1; let id = 0
    const ask = async (message: any) => { const wanted = ++id; bridge.onmessage?.({ data: { ...message, id: wanted } }); await flush(); return bridge.posted.find((row) => row.id === wanted) }
    setActiveNode('node-b'); held.qc = { getQueryData: () => ({ 'plugin:audit:value': JSON.stringify('cache-b') }) }
    b = await renderCells(() => <RemoteTree contribution={contribution} props={() => ({ taskId: 'task-b' })} scope={() => ({ taskId: 'task-b' })} />, { width: 80, height: 24 })
    a.done(); a = null
    const readAfterA = await ask({ kind: 'document', op: 'read' }); const stateAfterA = await ask({ kind: 'state.get', key: 'value' }); await ask({ kind: 'api', method: 'GET', path: '/v1/p/audit/read' })
    expect(readAfterA.body.text).toBe('document-a')
    b.done(); b = null; _stopAllTreeWorkers()
    writeFileSync(output, JSON.stringify({ fixture: 'Actual TUI RemoteTree, renderCells, workerHost, broker and frameServices; transport and API seam faked', readAfterFirstSlotDisposed: readAfterA, stateAfterFirstSlotDisposed: stateAfterA, requestNode: held.calls.at(-1)?.options.nodeId, spawned, terminated }, null, 2) + '\n')
  } finally { a?.done(); b?.done(); _stopAllTreeWorkers(); _setWorkerFactory(null); setActiveNode(null); vi.unstubAllGlobals() }
})
