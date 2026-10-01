import { createComponent, onCleanup } from 'solid-js'
import { createComponent as webCreateComponent, render } from 'solid-js/web'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/solid-query'
import { MessageChannel, Worker } from 'node:worker_threads'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { prefsKey } from '@acorn/protocol/api.ts'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/plugin/apiVersion.ts'
import { registerQueryOwner } from '../../packages/client-core/src/infra/node/queryOwnership'
const held = vi.hoisted(() => ({ bundle: '', workers: [] as any[], messages: [] as any[], calls: [] as any[], resolves: [] as (() => void)[] }))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
vi.mock('../../apps/tui/src/plugins/custody', () => ({ bundlePath: () => held.bundle }))
// Both before and after owners use these exact production API service seams.
vi.mock('../../packages/client-core/src/infra/node/apiClient', () => ({
  sendRaw: async (path: string, options: any) => {
    held.calls.push({ path, nodeId: options.nodeId, signal: options.signal })
    if (path.endsWith('/slow')) await new Promise<void>((resolve) => held.resolves.push(resolve))
    return { ok: true, status: 200, body: { nodeId: options.nodeId } }
  }, sendRawBytes: () => {},
}))
vi.mock('/tmp/acorn-perf-unit06-before/packages/client-core/src/infra/node/apiClient', () => ({
  sendRaw: async (path: string, options: any) => { held.calls.push({ path, nodeId: options.nodeId, signal: options.signal }); return { ok: true, status: 200, body: { nodeId: options.nodeId } } }, sendRawBytes: () => {},
}))
import { RemoteTree } from 'unit06-remote-tree'
import { _stopAllTreeWorkers, _setWorkerFactory } from 'unit06-worker-host'
import { _seedPluginDistribution, _resetPluginDistribution } from 'unit06-distribution'
import { setActiveNode } from 'unit06-active-node'
import { installPluginWorkers } from 'unit06-worker-factory'
const wait = async (check: () => boolean) => {
  const until = Date.now() + 8000
  while (!check()) { if (Date.now() > until) throw new Error(`probe deadline: ${JSON.stringify({messages:held.messages,workers:held.workers.map(w=>({threadId:w.threadId})),calls:held.calls})}`); await new Promise((resolve) => setTimeout(resolve, 5)) }
}
it('records actual SDK, worker, providers and host bridge authority', async () => {
  const before = process.env.ACORN_PERF_OWNER === 'before'
  const sdk = process.env.ACORN_PERF_SDK ?? 'legacy'
  const equivalent = process.env.ACORN_PERF_EQUIVALENT === '1'
  const bothDocuments = process.env.ACORN_PERF_DOCUMENTS === 'both' || equivalent
  const heldOperation = process.env.ACORN_PERF_HELD === '1'
  const warmCount = Number(process.env.ACORN_PERF_WARM ?? 0)
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  held.bundle = `/tmp/acorn-perf-unit06-${sdk}-bundle${process.env.ACORN_PERF_DELAY ? '-delayed' : ''}/bundle.mjs`
  const ownedChannels: { firstCloses: number; secondCloses: number }[] = []
  class ObservedChannel extends MessageChannel {
    constructor() {
      super()
      const counts = { firstCloses: 0, secondCloses: 0 }
      ownedChannels.push(counts)
      const firstClose = this.port1.close.bind(this.port1), secondClose = this.port2.close.bind(this.port2)
      this.port1.close = () => { counts.firstCloses++; firstClose() }
      this.port2.close = () => { counts.secondCloses++; secondClose() }
    }
  }
  vi.stubGlobal('MessageChannel', ObservedChannel)
  const rows = [{ name: 'audit', installed: { version: '1', apiVersion: PLUGIN_API_MAJOR,
    permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
    client: { hash: 'a'.repeat(64), bytes: readFileSync(held.bundle).length }, contributions: { frames: [] } } }]
  _seedPluginDistribution([['node-a', rows], ['node-b', rows]] as any, [`audit ${'a'.repeat(64)}`])
  const realPost = Worker.prototype.postMessage
  const posting = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, message: any, transfer: any) {
    if (message?.acornBridge && !held.workers.includes(this)) {
      held.workers.push(this)
      const worker = this
      let listening = false
      let hello: any[] | null = null
      worker.on('message', (value: any) => {
        held.messages.push({ worker: held.workers.indexOf(worker), ...value })
        if (value.phase === 'listening') { listening = true; if (hello) { realPost.call(worker, hello[0], hello[1]); hello = null } }
      })
      if (process.env.ACORN_PERF_BARRIER !== '0' && !listening) { hello = [message, transfer]; return }
    }
    return realPost.call(this, message, transfer)
  })
  installPluginWorkers()
  let constructions = 0, cleanups = 0
  const docs = { a: 'document-a', b: 'document-b' }
  const handles = { a: { read: () => docs.a, write: (text: string) => { docs.a = text }, flush: async () => {} }, b: { read: () => docs.b, write: (text: string) => { docs.b = text }, flush: async () => {} } }
  const grants = { a: () => handles.a, b: () => handles.b }
  if (equivalent) grants.b = grants.a
  const qa = new QueryClient()
  const qcs = { a: qa, b: equivalent ? qa : new QueryClient() }
  for (const which of ['a', 'b'] as const) { if (equivalent && which === 'b') continue; registerQueryOwner(qcs[which], `node-${which}`); qcs[which].setQueryData(prefsKey, { 'plugin:audit:value': JSON.stringify(`cache-${which}`) }) }
  const stops: (() => void)[] = []
  const mount = (which: 'a' | 'b', label: string, grant = true) => {
    const host = document.createElement('div'); document.body.append(host)
    const owner = () => { constructions++; expect(useQueryClient()).toBe(qcs[which]); onCleanup(() => cleanups++); return <RemoteTree contribution={{pluginId:'audit',id:'audit.panel',entry:'panel',hash:'a'.repeat(64)}} props={() => ({label})} scope={() => ({taskId:'same-task',projectId:'same-project'})} {...(grant ? { document: grants[which] } : {})} /> }
    const stop = render(() => <QueryClientProvider client={qcs[which]}>{createComponent(owner,{})}</QueryClientProvider>, host)
    let stopped = false
    const retire = () => { if(stopped)return;stopped=true;stop();host.remove() }
    stops.push(retire)
    return { host, stop: retire }
  }
  let request = 0
  const ask = async (worker: number, label: string, op: string, retired = false, text?: string) => {
    const id = ++request
    held.workers[worker].postMessage({ probe: {id,label,op,retired,text} })
    await wait(() => held.messages.some((m) => m.phase === 'reply' && m.id === id))
    return held.messages.find((m) => m.phase === 'reply' && m.id === id).result
  }
  try {
    expect(createComponent).toBe(webCreateComponent)
    setActiveNode('node-a'); const a = mount('a','a')
    if (process.env.ACORN_PERF_EXPECT_STARTUP_FAILURE === '1') {
      let failure: unknown = null
      try { await wait(() => held.messages.some((m) => m.phase === 'mounted' && m.label === 'a')) } catch (error) { failure = String(error) }
      expect(failure).not.toBeNull()
      expect(held.calls).toHaveLength(0)
      writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `evidence/unit06-owner-${tag}.json`), JSON.stringify({ expectedStartupFailure: true, before, sdk, listeningBarrier: false, failure, workers: held.workers.length, messages: held.messages, calls: held.calls }, null, 2) + '\n', { flag: 'wx' })
      return
    }
    await wait(() => held.messages.some((m) => m.phase === 'mounted' && m.label === 'a'))
    setActiveNode('node-b'); const b = mount('b','b', bothDocuments)
    await wait(() => held.messages.some((m) => m.phase === 'mounted' && m.label === 'b'))
    const first = held.messages.find((m) => m.phase === 'mounted' && m.label === 'a')
    const second = held.messages.find((m) => m.phase === 'mounted' && m.label === 'b')
    let heldId = 0
    if (heldOperation) {
      heldId = ++request
      held.workers[first.worker].postMessage({ probe: { id: heldId, label: 'a', op: 'slow' } })
      await wait(() => held.calls.some((call) => call.path.endsWith('/slow')))
    }
    a.stop(); await wait(() => held.messages.some((m) => m.phase === 'retired' && m.label === 'a') || held.workers[first.worker].threadId === -1)
    const heldSignalAborted = held.calls.find((call) => call.path.endsWith('/slow'))?.signal?.aborted
    for (const resolve of held.resolves.splice(0)) resolve()
    let retiredApi: unknown = null
    if (!before && sdk === 'modern') retiredApi = await ask(first.worker, 'a', 'retired-api', true)
    const secondApi = await ask(second.worker,'b','read-api')
    const secondDocument = await ask(second.worker,'b','read')
    const writesAfterFirstRetired = await ask(second.worker,'b','write',false,'foreign-write')
    const focus = b.host.querySelector('button')
    focus?.focus()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const secondNavigation = await ask(second.worker, 'b', 'navigate')
    open.mockRestore()
    let revokedDocument: unknown = null
    if (!before && bothDocuments) {
      if (equivalent) (handles as any).a = null
      else (handles as any).b = null
      revokedDocument = await ask(second.worker, 'b', 'read')
    }
    b.stop()
    for (let i = 0; i < warmCount; i++) {
      // A fresh structural grant is admitted for each new owner; the old revoked bridge stays dead.
      handles.a = { read: () => docs.a, write: (text: string) => { docs.a = text }, flush: async () => {} }
      const label = `warm-${i}`
      const warmed = mount('a', label)
      await wait(() => held.messages.some((message) => message.phase === 'mounted' && message.label === label))
      warmed.stop()
      if (sdk === 'modern') await wait(() => held.messages.some((message) => message.phase === 'retired' && message.label === label))
    }
    await new Promise((resolve) => setTimeout(resolve,20))
    const afterRetireWorkers = held.workers.map((worker) => worker.threadId)
    const result = { fixture: 'Actual desktop RemoteTree, QueryClientProvider, SDK bytes, permission-scoped TUI worker factory, FrameBridge and frameServices. API only is an origin recorder; no native timing.', before, sdk, listeningBarrier: process.env.ACORN_PERF_BARRIER !== '0', solidIdentity: createComponent===webCreateComponent, constructions, cleanups,
      hostChannels: ownedChannels.length, hostEndpointCloseCallsBeforePoolStop: ownedChannels.reduce((count, pair) => count + pair.firstCloses, 0), transferredOriginalCloseCallsBeforePoolStop: ownedChannels.reduce((count, pair) => count + pair.secondCloses, 0),
      equivalent, bothDocuments, heldOperation, warmCount, heldId, heldSignalAborted, retiredApi, revokedDocument, secondNavigation, first, second, secondApi, secondDocument, writesAfterFirstRetired, docs, afterRetireWorkers, workers:held.workers.length, topLevelCalls:held.calls.filter((c)=>c.path.endsWith('/top-level')).map((c)=>c.nodeId), calls:held.calls.map(({path,nodeId})=>({path,nodeId})) }
    if (!before) {
      const node = equivalent ? 'node-a' : 'node-b'
      expect(second.api.body.nodeId).toBe(node)
      expect(second.state.body).toBe(equivalent ? 'cache-a' : 'cache-b')
      expect(secondApi.body.nodeId).toBe(node)
      expect(second.document.ok).toBe(bothDocuments)
      expect(writesAfterFirstRetired.ok).toBe(bothDocuments)
      if (bothDocuments) expect(second.document.body).toBe(equivalent ? 'document-a' : 'document-b')
      else expect(docs.a).toBe('document-a')
      expect(secondNavigation.ok).toBe(true)
      if (heldOperation && !(equivalent && sdk === 'legacy')) expect(heldSignalAborted).toBe(true)
      if (sdk === 'modern') expect(retiredApi).toMatchObject({ ok: false, code: 'unmounted' })
      if (bothDocuments) expect(revokedDocument).toMatchObject({ ok: false })
    }
    writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `evidence/unit06-owner-${tag}.json`),JSON.stringify(result,null,2)+'\n', { flag: 'wx' })
  } finally {
    for(const stop of stops) stop()
    for(const resolve of held.resolves) resolve()
    _stopAllTreeWorkers();_setWorkerFactory(null);_resetPluginDistribution();setActiveNode(null)
    await Promise.all(held.workers.map((worker)=>worker.terminate()))
    for(const qc of Object.values(qcs)) qc.clear()
    posting.mockRestore()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
