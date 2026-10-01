import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
const held = vi.hoisted(() => ({ qc: { getQueryData: () => ({ 'plugin:audit:value': JSON.stringify('cache-a') }) } as any, calls: [] as any[] }))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => held.qc }))
vi.mock('../../packages/client-core/src/host/tree/TreeHost', () => ({ TreeHost: () => <button>tree</button> }))
vi.mock('../../packages/client-core/src/infra/node/apiClient', () => ({ sendRaw: async (path: string, options: unknown) => { held.calls.push({ path, options }); return { ok: true, status: 200, body: null } }, sendRawBytes: () => {} }))
vi.mock('../../packages/client-core/src/host/plugins/contributions', () => ({ eligiblePlugins: () => [{ pluginId: 'audit', installed: { permissions: { api: [], events: [] }, contributions: { frames: [] } } }], isTaskPane: () => false }))
import { RemoteTree } from '../../packages/client-core/src/host/tree/RemoteTree'
import { _setWorkerFactory, _stopAllTreeWorkers, acquireTreeWorker } from '../../packages/client-core/src/host/tree/workerHost'
import { setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
class Port { onmessage: ((event: any) => void) | null = null; posted: any[] = []; closed = false; start() {} close() { this.closed = true } postMessage(data: any) { this.posted.push(data) } }
const channels: { port1: Port; port2: Port }[] = []
class Channel { port1 = new Port(); port2 = new Port(); constructor() { channels.push(this) } }
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
it('records first-slot bridge custody through concurrent mounts and 100 warm remounts', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'; const output = `plans/performance/16-pool-${tag}.json`
  if (tag.startsWith('before') && existsSync(output)) throw new Error('Before exists')
  vi.stubGlobal('MessageChannel', Channel)
  let spawned = 0, terminated = 0; const docs = { a: 'document-a', b: 'document-b' }
  _setWorkerFactory(() => ({ postMessage() {}, terminate() { terminated++ }, onerror: null }) as any)
  // Count actual worker starts separately from fake transport delivery.
  _setWorkerFactory(() => { spawned++; return { postMessage() {}, terminate() { terminated++ }, onerror: null } as any })
  const contribution = { pluginId: 'audit', id: 'audit.panel', hash: 'a'.repeat(64), entry: 'panel' }
  const mount = (which: 'a' | 'b', documentGrant = true) => {
    const host = document.createElement('div'); document.body.append(host)
    const stop = render(() => <RemoteTree contribution={contribution} props={() => ({ taskId: `task-${which}` })} scope={() => ({ taskId: `task-${which}` })}
      {...(documentGrant ? { document: () => ({ read: () => docs[which], write: (text: string) => { docs[which] = text }, flush: async () => {} }) } : {})} />, host)
    return { host, stop: () => { stop(); host.remove() } }
  }
  const snapshots: any[] = []
  try {
    setActiveNode('node-a'); const a = mount('a'); const bridge = channels[0]!.port1
    let id = 0
    const ask = async (message: any) => { const wanted = ++id; bridge.onmessage?.({ data: { ...message, id: wanted } }); await flush(); return bridge.posted.find((row) => row.id === wanted) }
    setActiveNode('node-b'); held.qc = { getQueryData: () => ({ 'plugin:audit:value': JSON.stringify('cache-b') }) }
    const b = mount('b', false)
    snapshots.push({ phase: 'both mounted, B has no document grant', read: await ask({ kind: 'document', op: 'read' }), state: await ask({ kind: 'state.get', key: 'value' }) })
    await ask({ kind: 'api', method: 'GET', path: '/v1/p/audit/read' })
    snapshots.push({ phase: 'B mounted API', requestNode: held.calls.at(-1)?.options.nodeId })
    a.stop()
    snapshots.push({ phase: 'first slot retired', bridgeClosed: bridge.closed, read: await ask({ kind: 'document', op: 'read' }) })
    b.host.querySelector('button')?.focus()
    snapshots.push({ phase: 'B focused', navigation: await ask({ kind: 'ui', op: 'openUrl', url: 'https://example.test' }) })
    await ask({ kind: 'document', op: 'write', text: 'written-after-a-retired' }); b.stop()
    for (let i = 0; i < 100; i++) { const next = mount('b'); next.stop() }
    snapshots.push({ phase: 'after 100 warm remounts', read: await ask({ kind: 'document', op: 'read' }), spawned, ports: channels.length * 2, terminated })
    _stopAllTreeWorkers()
    const result = { fixture: 'Actual desktop RemoteTree + workerHost + createFrameBridge + frameServices; Worker/MessageChannel transport and API seam faked, no native timings', snapshots, docs, final: { terminated, closedPorts: channels.reduce((n, c) => n + Number(c.port1.closed) + Number(c.port2.closed), 0) } }
    expect(result.docs.a).toBe('written-after-a-retired')
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  } finally { _stopAllTreeWorkers(); _setWorkerFactory(null); setActiveNode(null); vi.unstubAllGlobals() }
})
it('records cleanup after bridge setup throws', () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'; const output = `plans/performance/16-pool-start-${tag}.json`
  if (tag.startsWith('before') && existsSync(output)) throw new Error('Before exists')
  channels.length = 0; vi.stubGlobal('MessageChannel', Channel); let spawned = 0, terminated = 0
  _setWorkerFactory(() => { spawned++; return { postMessage() {}, terminate() { terminated++ }, onerror: null } as any })
  try {
    for (let i = 0; i < 10; i++) expect(() => acquireTreeWorker({ pluginId: 'audit', hash: 'b'.repeat(64), connect: () => { throw new Error('synthetic bridge setup failure') }, onRefused() {} })).toThrow()
    _stopAllTreeWorkers()
    writeFileSync(output, JSON.stringify({ fixture: 'Actual workerHost.start with failing host connect', spawned, terminatedAfterStopAll: terminated, channels: channels.length, closedPorts: channels.reduce((n, c) => n + Number(c.port1.closed) + Number(c.port2.closed), 0) }, null, 2) + '\n')
  } finally { _setWorkerFactory(null); vi.unstubAllGlobals() }
})
