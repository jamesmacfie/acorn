// Read-only audit: actual store/API/WS owners, synthetic deferred Node transport.
import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { managedAgentStore } from '../../plugins/agents/src/client/sessions/managedStore'
import { setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
import { _resetWsClient } from '../../packages/client-core/src/infra/node/wsClient'
import { activateScopedStateEviction } from '../../apps/desktop/src/client/scopedEviction'
import { managedDraft, setManagedDraft, hydrateManagedDraft } from '../../plugins/agents/src/client/sessions/managedDrafts'
import { composerDraftState } from '../../plugins/agents/src/client/composer/composerState'
import { rememberReadingPlace, readingPlace } from '../../plugins/agents/src/client/sessions/readingPlaceStore'
import { foldToolEvents } from '../../plugins/agents/src/shared/toolFold'
import type { AgentEventRecord, AgentSession, AgentSessionSnapshot } from '../../plugins/agents/src/contract/wire'

const baseline = !!process.env.ACORN_PERF_BASELINE
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
const dir = dirname(fileURLToPath(import.meta.url))
const record = (name: string, value: unknown) => writeFileSync(join(dir, `08-${name}-${tag}.json`), JSON.stringify(value, null, 2) + '\n')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const row = (origin: string, seq = 0, id = 'same-session'): AgentSession => ({
  id, taskId: 'same-task', title: origin, config: {}, runtimeState: 'ready', controller: 'acorn',
  kind: 'interactive', createdAt: 1, updatedAt: origin === 'node-a' ? 10 : 1, lastEventSeq: seq,
  lastReadSeq: 0, attention: 'none', subagents: [], archivedAt: null,
} as unknown as AgentSession)
const event = (seq: number, origin: string, id = 'same-session'): AgentEventRecord => ({
  id: `${origin}-${seq}`, sessionId: id, turnId: 'turn', seq, schemaVersion: 1, createdAt: seq,
  searchText: null, event: { type: 'assistant_message', text: origin, messageId: `${origin}-${seq}` },
})
const snapshot = (origin: string, seq = 1, id = 'same-session'): AgentSessionSnapshot => ({
  session: row(origin, seq, id), events: [event(seq, origin, id)], turns: [], requests: [],
})
const reply = (body: unknown) => ({ status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) })

it('records stale roster/snapshot completion and cross-Node paging with actual transport ownership', async () => {
  const requests: { nodeId: string; path: string; resolve: (value: unknown) => void }[] = []
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {}, nodeFetch: (nodeId: string, request: { path: string }) =>
    new Promise(resolve => requests.push({ nodeId, path: request.path, resolve: body => resolve(reply(body)) })),
  } })
  const off = activateScopedStateEviction()
  const scenarios = []
  for (const method of ['loadTask', 'loadAll', 'loadAttention'] as const) {
    setActiveNode('node-a'); managedAgentStore.clear(); requests.length = 0
    const old = method === 'loadTask' ? managedAgentStore.loadTask('same-task') : managedAgentStore[method]()
    setActiveNode('node-b')
    managedAgentStore.upsertSession(row('node-b'))
    requests[0].resolve({ sessions: [row('node-a')], delegations: [], nextCursor: null })
    if (baseline) await old
    else await expect(old).rejects.toThrow(/no longer owns/)
    const observed = managedAgentStore.sessions()[0]?.title
    scenarios.push({ method, requestOrigin: requests[0].nodeId, active: 'node-b', observed,
      isolationInvariantPassed: observed === 'node-b' })
    expect(observed).toBe(baseline ? 'node-a' : 'node-b') // Explicit fail-before characterization; invert after a fix.
  }

  setActiveNode('node-a'); managedAgentStore.clear(); requests.length = 0
  const releaseOld = managedAgentStore.hold('same-session')
  const old = managedAgentStore.loadSnapshot('same-session')
  setActiveNode('node-b')
  const releaseNew = managedAgentStore.hold('same-session')
  const incoming = managedAgentStore.loadSnapshot('same-session')
  requests[1].resolve(snapshot('node-b'))
  await incoming
  requests[0].resolve(snapshot('node-a'))
  if (baseline) await old
  else await expect(old).rejects.toThrow(/no longer owns/)
  const collision = {
    requests: requests.map(({ nodeId, path }) => ({ nodeId, path })),
    sessionTitle: managedAgentStore.sessions()[0]?.title,
    eventOrigins: managedAgentStore.snapshots()['same-session']?.events.map(item => item.event.type === 'assistant_message' ? item.event.text : ''),
  }
  expect(collision.eventOrigins).toEqual(baseline ? ['node-b', 'node-a'] : ['node-b'])

  // Count holds through the public bound: both mounted surfaces retain one aggregate count until
  // their own release. A late old release must not remove the new hold. After both release, 3 remain.
  const fill = async (prefix: string) => {
    for (let i = 0; i < 4; i++) {
      const run = managedAgentStore.loadSnapshot(`${prefix}-${i}`)
      requests.at(-1)!.resolve(snapshot('node-b', 1, `${prefix}-${i}`))
      await run
    }
  }
  await fill('first')
  const whileBothHeld = Object.keys(managedAgentStore.snapshots())
  releaseOld()
  await fill('second')
  const afterOldRelease = Object.keys(managedAgentStore.snapshots())
  releaseNew()
  const afterBothReleased = Object.keys(managedAgentStore.snapshots())
  expect(afterOldRelease).toContain('same-session')
  expect(afterBothReleased.length).toBe(3)

  setActiveNode('node-a'); managedAgentStore.clear(); requests.length = 0
  const paged = managedAgentStore.loadSnapshot('same-session')
  if (!baseline) void paged.catch(() => undefined)
  setActiveNode('node-b')
  const firstPage = snapshot('node-a'); firstPage.session.lastEventSeq = 2
  requests[0].resolve(firstPage)
  await tick()
  if (baseline) {
    requests[1].resolve({ events: [event(2, 'node-b')], nextCursor: null })
    await paged
  } else await expect(paged).rejects.toThrow(/no longer owns/)
  const paging = {
    requests: requests.map(({ nodeId, path }) => ({ nodeId, path })),
    origins: managedAgentStore.snapshots()['same-session']?.events.map(item => item.event.type === 'assistant_message' ? item.event.text : ''),
  }
  expect(paging.requests.map(item => item.nodeId)).toEqual(baseline ? ['node-a', 'node-b'] : ['node-a'])
  record('store-lifecycle', { fixture: 'actual managedStore, managedClient, apiClient, activeNode and scope eviction; deferred synthetic Node replies; expected failures are recorded', scenarios, collision,
    holds: { whileBothHeld, afterOldRelease, afterBothReleased }, paging })
  off(); managedAgentStore.clear(); setActiveNode(null); delete (window as any).acorn
})

it('records text draft lifetime and colliding scope versus bounded reading place', () => {
  const id = 'audit-draft-collision'
  setActiveNode('node-a')
  const off = activateScopedStateEviction()
  setManagedDraft(id, 'Synthetic unsent text from node A')
  composerDraftState(id).setContexts([{ content: 'synthetic context' } as any])
  rememberReadingPlace(id, { at: 'live' })
  managedAgentStore.removeSession(id)
  const afterRemove = { text: managedDraft(id), contexts: composerDraftState(id).contexts().length }
  setActiveNode('node-b')
  hydrateManagedDraft(id, 'Synthetic unsent text from node B')
  const afterSwitch = { text: managedDraft(id), contexts: composerDraftState(id).contexts().length }
  for (let i = 0; i < 51; i++) rememberReadingPlace(`view-${i}`, { at: 'history', anchor: { key: `row-${i}`, offset: 1 }, top: 1 } as any)
  const readingBound = { oldestEvicted: readingPlace('view-0').at === 'live', newestKept: readingPlace('view-50').at !== 'live' }
  if (baseline) expect(afterRemove.text).toContain('node A')
  else expect(afterRemove.text).toBe('')
  expect(afterSwitch.text).toContain(baseline ? 'node A' : 'node B')
  record('draft-lifecycle', { fixture: 'actual managedDrafts/composerState/readingPlaceStore and managedStore deletion/scope eviction; synthetic strings only', afterRemove, afterSwitch, readingBound })
  off(); managedAgentStore.clear(); setActiveNode(null)
})

it('counts retained live tool updates and steady append CPU through real WS and store', async () => {
  let receive: ((nodeId: string, frame: unknown) => void) | undefined
  const source = snapshot('node-b', 0)
  source.events = []
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {}, onNodeBytes: () => () => {},
    onNodeFrame: (cb: typeof receive) => { receive = cb; return () => {} }, nodeSend: () => {},
    nodeFetch: async () => reply(source),
  } })
  _resetWsClient(); setActiveNode('node-b'); managedAgentStore.clear()
  const release = managedAgentStore.activate()
  await managedAgentStore.loadSnapshot('same-session')
  const samples = []
  const delta = 'x'.repeat(1024)
  for (let batch = 1; batch <= 4; batch++) {
    const started = performance.now()
    const cpuBefore = process.cpuUsage()
    for (let i = 1; i <= 2_000; i++) {
      const seq = (batch - 1) * 2_000 + i
      receive!('node-b', { channel: 'agent:event', event: { ...event(seq, 'node-b'),
        event: { type: 'tool', tool: { id: 'one-tool', title: 'Synthetic tool', output: delta, outputAppend: true } } } })
    }
    const ms = performance.now() - started
    const cpu = process.cpuUsage(cpuBefore)
    const events = managedAgentStore.snapshots()['same-session'].events
    samples.push({ updates: events.length, batchSynchronousWallMs: ms, processCPUms: (cpu.user + cpu.system) / 1000, averagePerAppendWallMs: ms / 2_000, rawJsonBytes: new TextEncoder().encode(JSON.stringify(events)).byteLength,
      foldedRows: foldToolEvents(events).length, foldedJsonBytes: new TextEncoder().encode(JSON.stringify(foldToolEvents(events))).byteLength })
  }
  record('live-tools', { fixture: 'actual WS channel -> managedStore; 8000 synthetic 1KiB append updates for one tool; no DOM, no real network; process.cpuUsage brackets dispatch+store, serialized logical bytes are not retained heap', samples })
  release(); managedAgentStore.clear(); _resetWsClient(); setActiveNode(null); delete (window as any).acorn
})
