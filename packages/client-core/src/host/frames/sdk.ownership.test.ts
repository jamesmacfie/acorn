import { MessageChannel } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import type { PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import { connect, mountTree, _resetConnection, type AcornBridge, type TreeMount } from './sdk'
const channels: MessageChannel[] = []
const channel = () => { const value = new MessageChannel(); channels.push(value); return value }
const listeners = new Set<(event: MessageEvent) => void>()
const context: PluginFrameContext = { surface: 'panel', target: 'remote', nodeId: 'bootstrap', theme: 'light', style: 'terminal' }
afterEach(() => {
  for (const pair of channels.splice(0)) { pair.port1.close(); pair.port2.close() }
  listeners.clear(); _resetConnection(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const boot = async (modern: boolean) => {
  _resetConnection()
  vi.stubGlobal('addEventListener', (kind: string, listener: (event: MessageEvent) => void) => { if (kind === 'message') listeners.add(listener) })
  vi.stubGlobal('removeEventListener', (kind: string, listener: (event: MessageEvent) => void) => { if (kind === 'message') listeners.delete(listener) })
  const bootstrap = channel(), tree = channel()
  const connecting = connect()
  for (const listener of listeners) listener({ data: { acornBridge: 1, ...(modern ? { treeSlotBridge: 1 } : {}) }, ports: [bootstrap.port2, tree.port2] } as unknown as MessageEvent)
  bootstrap.port1.postMessage({ kind: 'ready', context })
  return { bridge: await connecting, bootstrap, tree }
}
it('owns distinct mounted bridge requests, listeners, host waits, and transferred port retirement', async () => {
  const { bridge, tree } = await boot(true)
  expect(bridge.treeBridgeMode).toBe('bootstrap')
  const ready = vi.fn()
  tree.port1.onmessage = (event) => { if (event.data.kind === 'tree:ready') ready() }
  const mounted: { bridge: AcornBridge; mount: TreeMount }[] = []
  mountTree({ panel: (bridge, mount) => mounted.push({ bridge, mount }) })
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
  const first = channel(), second = channel()
  const closeFirst = vi.fn()
  first.port1.on('close', closeFirst)
  first.port1.on('message', () => {})
  tree.port1.postMessage({ kind: 'tree:mount', slot: 'a', entry: 'panel', props: { item: 'a' } }, [first.port2])
  tree.port1.postMessage({ kind: 'tree:mount', slot: 'b', entry: 'panel', props: { item: 'b' } }, [second.port2])
  first.port1.postMessage({ kind: 'ready', context: { ...context, nodeId: 'node-a' } })
  second.port1.postMessage({ kind: 'ready', context: { ...context, nodeId: 'node-b' } })
  await vi.waitFor(() => expect(mounted).toHaveLength(2))
  expect(mounted.map((slot) => slot.bridge.context.nodeId)).toEqual(['node-a', 'node-b'])
  expect(mounted[0].bridge.treeBridgeMode).toBe('mount')
  const selected = vi.fn()
  mounted[0].bridge.onSelect(selected)
  const pending = mounted[0].bridge.api.get('/held').catch((error) => error.code)
  const hostPending = mounted[0].mount.host.invoke('held').catch((error) => error.code)
  tree.port1.postMessage({ kind: 'tree:unmount', slot: 'a' })
  expect(await pending).toBe('unmounted')
  expect(await hostPending).toBe('unmounted')
  // The transferred endpoint is a new object at the receiver. Its opposite endpoint reports closure.
  await vi.waitFor(() => expect(closeFirst).toHaveBeenCalledOnce())
  first.port1.postMessage({ kind: 'select', item: 'late' })
  mounted[0].bridge.onSelect(selected)
  expect(await mounted[0].bridge.api.get('/retired').catch((error) => error.code)).toBe('unmounted')
  expect(selected).not.toHaveBeenCalled()
  second.port1.onmessage = (event) => { if (event.data.kind === 'api') second.port1.postMessage({ id: event.data.id, ok: true, body: 'survived' }) }
  expect(await mounted[1].bridge.api.get('/survivor')).toBe('survived')
  tree.port1.postMessage({ kind: 'tree:unmount', slot: 'b' })
})
it('labels a capable SDK on a legacy host and keeps the usable global bridge', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { bridge, bootstrap, tree } = await boot(false)
  expect(bridge.treeBridgeMode).toBe('legacy')
  const mounted: AcornBridge[] = []
  mountTree({ panel: (bridge) => mounted.push(bridge) })
  await new Promise<void>((resolve) => { tree.port1.onmessage = (event) => { if (event.data.kind === 'tree:ready') resolve() } })
  tree.port1.postMessage({ kind: 'tree:mount', slot: 'legacy', entry: 'panel', props: {} })
  await vi.waitFor(() => expect(mounted).toEqual([bridge]))
  bootstrap.port1.onmessage = (event) => { if (event.data.kind === 'api') bootstrap.port1.postMessage({ id: event.data.id, ok: true, body: 'usable' }) }
  expect(await mounted[0].api.get('/legacy')).toBe('usable')
  expect(console.warn).toHaveBeenCalledOnce()
  tree.port1.postMessage({ kind: 'tree:unmount', slot: 'legacy' })
})
