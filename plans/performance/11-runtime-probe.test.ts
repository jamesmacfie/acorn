import { it, expect } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { makeTestPluginDb } from '../../packages/node-core/src/testkit/db'
import { AgentStore } from '../../plugins/agents/src/server/sessions/store'
import { ManagedAgentRuntime } from '../../plugins/agents/src/server/sessions/runtime'
import { AgentDriverRegistry } from '../../plugins/agents/src/server/drivers/registry'
import type { AgentDriverStartOptions } from '../../plugins/agents/src/server/drivers/types'


const save = (name: string, value: unknown) => writeFile(new URL(`./11-${name}-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n')
const measure = async (fn: () => Promise<unknown>) => {
  const cpu = process.cpuUsage(), wall = performance.now()
  const value = await fn()
  return { wallMs: performance.now() - wall, cpuMs: Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b, 0) / 1000, value }
}
const core = (limits = { provider: 2, workspace: 3 }) => ({
  tasks: { requireRoot: async () => '/tmp', workspaceId: async () => 'workspace', active: async () => [{ id: 'task' }], idsForWorkspace: async () => ['task'] },
  prefs: { read: async () => JSON.stringify(limits) },
}) as any
function seedSessions(db: any, count: number, prefix = 's') {
  const statement = db.$client.prepare(`INSERT INTO agent_sessions (id,task_id,provider_id,profile_id,kind,driver_kind,driver_version,controller,runtime_state,attention,status_authority,title,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  db.$client.transaction(() => {
    for (let n = 0; n < count; n++) statement.run(`${prefix}${n}`, 'task', 'fake', 'fake', 'interactive', 'acp', 'probe', 'acorn', 'ready', 'none', 'protocol', 'Synthetic', '{}', n, n)
  })()
}
function countStatements(db: any) {
  let count = 0
  let lastQuery = ''
  const prepare = db.$client.prepare.bind(db.$client)
  db.$client.prepare = (query: string) => { count++; lastQuery = query; return prepare(query) }
  return { reset: () => { count = 0 }, value: () => count, query: () => lastQuery }
}

class ProbeRuntime extends ManagedAgentRuntime {
  runPump() { return this.pump() }
  async joinPump() { while (this.pumping) await new Promise(r => setTimeout(r, 1)) }
  counts() { return { live: this.live.size, active: [...this.live.values()].filter(item => item.activeTurnId).length, reconnectTimers: this.reconnectTimers.size, quietTimers: this.quietTimers.size } }
  push(session: string, event: any) { return this.onProviderEvent(session, event) }
  commit(session: string, turn: string | null, event: any) { return this.record(session, turn, event) }
  providerClosed(session: string) { return this.onProviderClosed(session, new Error('synthetic close')) }
}

it('measures queue scans and provider launches before concurrency admission', async () => {
  const scanDb = makeTestPluginDb('agents')
  const scans = []
  const plans = scanDb.db.$client.prepare(`EXPLAIN QUERY PLAN SELECT s.id, t.id FROM agent_turns t JOIN agent_sessions s ON s.id = t.session_id WHERE s.archived_at IS NULL AND s.controller = 'acorn' AND t.status = 'queued' AND t.ordinal = (SELECT min(h.ordinal) FROM agent_turns h WHERE h.session_id = s.id AND h.status = 'queued')`).all()
  try {
    const store = new AgentStore(scanDb.db, core()), counts = countStatements(scanDb.db)
    let previous = 0
    for (const count of [100, 1000, 5000]) {
      seedSessions(scanDb.db, count - previous, `size${count}-`)
      previous = count
      const runs = []
      for (let i = 0; i < 3; i++) {
        counts.reset()
        const result = await measure(() => store.queuedHeads())
        runs.push({ ...result, value: undefined, statements: counts.value(), heads: (result.value as any[]).length })
      }
      const queueQuery = counts.query()
      const queuePlan = process.env.ACORN_PERF_PHASE === 'before' ? undefined
        : scanDb.db.$client.prepare('EXPLAIN QUERY PLAN ' + queueQuery).all('queued', 'acorn')
      scans.push({ sessions: count, runs, queueQuery, queuePlan })
    }
  } finally { scanDb.cleanup() }

  const fixture = makeTestPluginDb('agents'), limits = { provider: 2, workspace: 3 }
  const callbacks = new Map<string, AgentDriverStartOptions>(), state = { launches: 0, stops: 0, sends: [] as string[], cancels: 0, probes: 0 }
  const finishes = new Map<string, () => Promise<void>>()
  const registry = new AgentDriverRegistry()
  const descriptor = { id: 'fake', profileId: 'fake', label: 'Synthetic', driverKind: 'acp', driverVersion: 'probe', installed: true, authenticated: true, statusAuthority: 'protocol', capabilities: [], configOptions: [], commands: [], skills: [], diagnostics: [] } as any
  registry.registerNative('fake', () => ({
    providerId: 'fake', profileId: 'fake',
    async probe() { state.probes++; await new Promise(r => setTimeout(r, 10)); return descriptor },
    async start(options) {
      state.launches++; callbacks.set(options.session.id, options)
      let ready = true
      finishes.set(options.session.id, async () => { ready = true; await options.onEvent({ type: 'turn_completed' }) })
      return {
        providerSessionRef: options.session.id,
        get ready() { return ready },
        async sendTurn() { ready = false; state.sends.push(options.session.id); return {} },
        async cancel() { state.cancels++; ready = true; await options.onEvent({ type: 'turn_completed', stopReason: 'cancelled' }) },
        async resolveRequest() {},
        async stop() { state.stops++; ready = false; callbacks.delete(options.session.id) },
      }
    },
  }))
  const runtime = new ProbeRuntime({ db: fixture.db, dataDir: fixture.dataDir, core: core(limits), internalEnv: () => ({}), secrets: {} as any, currentUserId: () => 'user', registry })
  try {
    seedSessions(fixture.db, 20)
    const turns = []
    for (let n = 0; n < 20; n++) turns.push((await runtime.store.enqueueTurn(`s${n}`, { input: [{ type: 'text', text: 'Synthetic' }], source: n === 19 ? 'workflow' : 'interactive', effectivePolicy: {}, idempotencyKey: `turn${n}` } as any)).turn)
    const launch = await measure(() => runtime.runPump())
    const initial = { ...runtime.counts(), ...state, sends: [...state.sends] }
    expect(initial.launches).toBe(process.env.ACORN_PERF_PHASE !== 'before' ? 2 : 20)
    expect(initial.active).toBe(2)
    limits.provider = 4; limits.workspace = 4
    await runtime.runPump()
    const raised = { ...runtime.counts(), sends: [...state.sends] }
    expect(raised.active).toBe(4)
    await finishes.get('s0')!(); await runtime.joinPump()
    await finishes.get('s1')!(); await runtime.joinPump()
    const fairness = { ...runtime.counts(), sends: [...state.sends] }
    expect(fairness.sends.slice(4, 6)).toEqual(['s4', 's19'])
    // Cancel a blocked queued head without dropping the other queued work.
    await runtime.cancelTurn('s18', turns[18].id)
    await runtime.runPump()
    expect((await runtime.store.turn(turns[18].id))?.status).toBe('cancelled')
    const blockedCancellation = { ...runtime.counts(), launches: state.launches, stops: state.stops }
    expect(blockedCancellation.live).toBe(process.env.ACORN_PERF_PHASE !== 'before' ? 6 : 20)
    // Lowering the ceiling leaves accepted turns alive and does not admit another one.
    limits.provider = 1; limits.workspace = 1
    await runtime.runPump()
    const lowered = { ...runtime.counts(), sends: [...state.sends] }
    expect(lowered.active).toBe(4)
    // Check scheduler ordering directly after five interactive dispatches.
    // No quota counter or process payload is claimed here; these are live fake driver handles.
    const providerReads = await measure(() => Promise.all(Array.from({ length: 20 }, () => runtime.providers())))
    const probesAfterConcurrent = state.probes
    await runtime.providers()
    expect(probesAfterConcurrent).toBe(1)
    expect(state.probes).toBe(1)
    // An external close means the fake provider has already exited, matching onClosed's contract.
    callbacks.delete('s19')
    await runtime.providerClosed('s19')
    const beforeStop = runtime.counts()
    const stopped = await measure(() => runtime.stop())
    const afterStop = { ...runtime.counts(), stops: state.stops, callbacks: callbacks.size }
    expect(afterStop.live).toBe(0)
    expect(afterStop.reconnectTimers).toBe(0)
    expect(afterStop.callbacks).toBe(0)
    await save('runtime', { plans, scans, launch: { ...launch, value: undefined }, initial, raised, fairness, blockedCancellation, lowered,
      providers: { concurrentRequests: 20, probes: probesAfterConcurrent, ...providerReads, value: undefined }, beforeStop, stop: { ...stopped, value: undefined }, afterStop })
  } finally { await runtime.stop(); fixture.cleanup() }
})

