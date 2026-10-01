import { it, expect } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { makeTestPluginDb } from '../../packages/node-core/src/testkit/db'
import { ManagedAgentRuntime } from '../../plugins/agents/src/server/sessions/runtime'

class WaitRuntime extends ManagedAgentRuntime {
  commit(session: string, event: any) { return this.record(session, null, event) }
}
const save = (value: unknown) => writeFile(new URL(`./09-wait-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n')

it('measures active wait reads with accumulated prior turns and tied session cursors', async () => {
  const fixture = makeTestPluginDb('agents')
  const runtime = new WaitRuntime({ db: fixture.db, dataDir: fixture.dataDir,
    core: { tasks: { root: async () => '/tmp', workspaceId: async () => 'workspace', active: async () => [{ id: 'task' }] } } as any,
    internalEnv: () => ({}), secrets: {} as any, currentUserId: () => null })
  try {
    const session = fixture.db.$client.prepare(`INSERT INTO agent_sessions (id,task_id,provider_id,profile_id,kind,driver_kind,driver_version,controller,runtime_state,attention,status_authority,title,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (let n = 0; n < 20; n++) session.run(`s${n}`, 'task', 'fake', 'fake', 'interactive', 'acp', 'probe', 'acorn', 'ready', 'none', 'protocol', 'Synthetic', '{}', 1000, 1000)
    const page1 = await runtime.store.listSessions({ taskId: 'task', limit: 5 })
    const page2 = await runtime.store.listSessions({ taskId: 'task', limit: 5, cursor: Number(page1.nextCursor) })
    expect(page1.sessions).toHaveLength(5)
    expect(page2.sessions).toHaveLength(0)
    const cursor = { tiedRows: 20, limit: 5, firstRows: page1.sessions.length, nextCursor: page1.nextCursor, secondRows: page2.sessions.length }

    const runs = []
    for (const [index, priorTurns] of [0, 1000].entries()) {
      const id = `s${index}`
      const turn = fixture.db.$client.prepare('INSERT INTO agent_turns (id,session_id,ordinal,source,status,input_json,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)')
      fixture.db.$client.transaction(() => {
        for (let n = 0; n < priorTurns; n++) turn.run(`${id}:turn${n}`, id, n, 'workflow', 'completed', JSON.stringify([{ type: 'text', text: 'synthetic '.repeat(100) }]), `${id}:key${n}`, n)
      })()
      const original = runtime.store.snapshot.bind(runtime.store)
      let reads = 0, mappedTurns = 0, mappedEvents = 0
      runtime.store.snapshot = async (...args) => {
        reads++
        const result = await original(...args)
        mappedTurns += result.turns.length; mappedEvents += result.events.length
        return result
      }
      const waiting = runtime.wait(id, 0, 'turn_completed', 30_000)
      await new Promise(r => setTimeout(r, 1))
      const cpu = process.cpuUsage(), started = performance.now()
      for (let n = 0; n < 100; n++) await runtime.commit(id, { type: 'diagnostic', level: 'info', message: `Synthetic ${n}` })
      await runtime.commit(id, { type: 'turn_completed' })
      const result = await waiting
      runs.push({ priorTurns, frames: 101, reads, mappedTurns, mappedEvents, wallMs: performance.now() - started,
        cpuMs: Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b, 0) / 1000, resultBytes: Buffer.byteLength(JSON.stringify(result)) })
      runtime.store.snapshot = original
    }
    await save({ cursor, runs })
  } finally { await runtime.stop(); fixture.cleanup() }
})
