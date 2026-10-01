import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel, Worker } from 'node:worker_threads'
import { QueryClient } from '@tanstack/solid-query'
import { expect, it, vi } from 'vitest'
const held = vi.hoisted(() => ({ path: '', calls: [] as string[] }))
vi.mock('./custody', () => ({ bundlePath: () => held.path }))
import { acquireTreeWorker, _stopAllTreeWorkers, _setWorkerFactory, type TreeWorkerHandle } from '@acorn/client-core/host/tree/workerHost.ts'
import { createFrameBridge, type FrameServices } from '@acorn/client-core/host/frames/broker.ts'
import { installPluginWorkers } from './workerFactory'

it('rotates held detection authority repeatedly without overlapping native replacements or replaying privileged calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'acorn-detection-rotation-'))
  held.path = join(directory, 'bundle.mjs')
  writeFileSync(held.path, `
    await new Promise(resolve => setTimeout(resolve, 200));
    let claimed = false;
    addEventListener('message', event => {
      if (!event.data.acornBridge) return;
      const [bridge, tree] = event.ports;
      bridge.onmessage = event => {
        if (event.data.kind !== 'ready' || claimed) return;
        claimed = true;
        bridge.postMessage({ kind: 'connected', version: 1 });
        bridge.postMessage({ kind: 'api', id: 1, method: 'GET', path: '/v1/p/audit/once' });
        tree.postMessage({ kind: 'tree:ready', version: 1 });
      };
      bridge.start();
    });
  `)
  const workers: Worker[] = [], leases: TreeWorkerHandle[] = [], qcs: QueryClient[] = []
  const realPost = Worker.prototype.postMessage, realTerminate = Worker.prototype.terminate
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  vi.stubGlobal('MessageChannel', MessageChannel)
  vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, message, transfer) {
    if ((message as { acornBridge?: number })?.acornBridge && !workers.includes(this)) workers.push(this)
    return realPost.call(this, message, transfer)
  })
  vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function (this: Worker) {
    const termination = realTerminate.call(this)
    return this === workers[0] ? termination.then(async (code) => { await gate; return code }) : termination
  })
  const wait = async (check: () => boolean) => {
    const until = Date.now() + 5000
    while (!check()) { if (Date.now() >= until) throw new Error('native detector rotation deadline'); await new Promise((resolve) => setTimeout(resolve, 5)) }
  }
  const acquire = (index: number) => {
    const qc = new QueryClient(); qcs.push(qc)
    const binding = { pluginId: 'audit', surface: 'panel', target: 'remote' as const, nodeId: `node-${index}`, api: [], events: [], panes: [], claimsKeys: [] }
    const context = { surface: 'panel', target: 'remote' as const, nodeId: binding.nodeId, theme: 'terminal', style: 'terminal' }
    const lease = acquireTreeWorker({
      pluginId: 'audit', hash: 'held-native-detection', authority: `authority-${index}`, context,
      connect: (port, hasFocus, legacyContext = context) => {
        const unavailable = () => { throw new Error('rotation fixture exposes API only') }
        const services: FrameServices = {
          fetch: async () => { held.calls.push(binding.nodeId); return { ok: true, status: 200, body: null } },
          fetchBytes: unavailable, subscribe: unavailable, stateGet: unavailable, stateSet: unavailable,
          toast: unavailable, copy: unavailable, openPane: unavailable, openTask: unavailable, openUrl: unavailable,
          frameHasFocus: hasFocus, importerDone: unavailable, importerClose: unavailable, keydown: unavailable,
        }
        return createFrameBridge({ port, binding, context: legacyContext, services, onMisbehaving: unavailable })
      },
      onRefused: () => {},
    })
    lease.mount(`slot-${index}`, 'panel', { index })
    leases.push(lease)
    return lease
  }
  try {
    installPluginWorkers()
    let current = acquire(0)
    expect(workers).toHaveLength(1)
    for (let index = 1; index <= 100; index++) {
      const next = acquire(index)
      current.release()
      current = next
    }
    expect(workers).toHaveLength(1)
    expect(held.calls).toEqual([])
    release()
    await wait(() => held.calls.length === 1)
    expect(workers).toHaveLength(2)
    expect(workers[0].threadId).toBe(-1)
    expect(held.calls).toEqual(['node-100'])
    current.release()
    await wait(() => workers[1].threadId === -1)
  } finally {
    release()
    for (const lease of leases) lease.release()
    _stopAllTreeWorkers(); _setWorkerFactory(null)
    await Promise.all(workers.map((worker) => realTerminate.call(worker)))
    for (const qc of qcs) qc.clear()
    vi.restoreAllMocks(); vi.unstubAllGlobals(); held.calls.length = 0
    rmSync(directory, { recursive: true, force: true })
  }
})
