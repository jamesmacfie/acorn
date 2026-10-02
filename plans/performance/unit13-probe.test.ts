import { it, expect } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { makeTestPluginDb } from '../../packages/plugin-api/src/testkit'
import type { CoreServices } from '@acorn/plugin-api/node'
import { ManagedAgentRuntime } from '../../plugins/agents/src/server/sessions/runtime'
import type { AgentNormalizedEvent } from '../../plugins/agents/src/contract/wire'

class ProbeRuntime extends ManagedAgentRuntime {
  commit(event: AgentNormalizedEvent) { return this.record('session', null, event) }
  listenerCount() { return this.listeners.size }
}

it('measures 101 frames against the cumulative wait owner', async () => {
  const cases = []
  for (const history of [0, 1_000]) {
    const fixture = makeTestPluginDb('agents')
    const core = { tasks: { root: async () => '/tmp' } } as unknown as CoreServices
    const runtime = new ProbeRuntime({ db: fixture.db, dataDir: fixture.dataDir, core, internalEnv: () => ({}), secrets: {} as never, currentUserId: () => null })
    try {
      fixture.db.$client.prepare(`INSERT INTO agent_sessions (id,task_id,provider_id,profile_id,kind,driver_kind,driver_version,controller,runtime_state,attention,status_authority,title,config_json,created_at,updated_at) VALUES ('session','task','fake','fake','interactive','acp','probe','acorn','ready','none','protocol','Synthetic','{}',0,0)`).run()
      const insert = fixture.db.$client.prepare(`INSERT INTO agent_turns (id,session_id,ordinal,source,status,input_json,effective_policy_json,idempotency_key,created_at) VALUES (?,'session',?,'interactive','completed','[]','{}',?,0)`)
      fixture.db.$client.transaction(() => { for (let n = 0; n < history; n++) insert.run(`old-${n}`, n, `key-${n}`) })()
      let snapshotReads = 0, mappedRows = 0, returnedBytes = 0, narrowReads = 0
      const snapshot = runtime.store.snapshot.bind(runtime.store)
      runtime.store.snapshot = async (...args) => {
        snapshotReads++
        const value = await snapshot(...args)
        mappedRows += 1 + value.turns.length + value.requests.length + value.events.length
        returnedBytes += Buffer.byteLength(JSON.stringify(value))
        return value
      }
      const store = runtime.store
      if (store.waitSnapshot) {
        const read = store.waitSnapshot.bind(store)
        store.waitSnapshot = async (...args) => {
          snapshotReads++
          const value = await read(...args)
          mappedRows += 1 + value.turns.length + value.requests.length + value.events.length
          returnedBytes += Buffer.byteLength(JSON.stringify(value))
          return value
        }
      }
      if (store.waitFacts) {
        const facts = store.waitFacts.bind(store)
        store.waitFacts = async (...args) => { narrowReads++; const value = await facts(...args); mappedRows += 1 + Number(value.terminal !== null); returnedBytes += Buffer.byteLength(JSON.stringify(value)); return value }
      }
      const cpu = process.cpuUsage(), wall = performance.now()
      const wait = runtime.wait('session', 0, 'turn_completed', 10_000)
      await new Promise((resolve) => setTimeout(resolve, 1))
      for (let n = 0; n < 100; n++) await runtime.commit({ type: 'diagnostic', level: 'info', message: `Synthetic ${n}` })
      await runtime.commit({ type: 'turn_completed' })
      const value = await wait
      expect(value.session.lastEventSeq).toBe(101)
      expect(runtime.listenerCount()).toBe(0)
      cases.push({ history, frames: 101, snapshotReads, narrowReads, mappedRows, returnedBytes, cpuMs: Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b, 0) / 1_000, wallMs: performance.now() - wall, listeners: runtime.listenerCount() })
    } finally { await runtime.stop(); fixture.cleanup() }
  }
  const paths = ['plugins/agents/src/server/sessions/sessionWait.ts', 'plugins/agents/src/server/sessions/store.ts', 'plugins/agents/src/server/sessions/runtime.ts', 'plugins/agents/src/server/sessions/sessionExecute.ts', 'plans/performance/unit13-probe.test.ts', 'plans/performance/unit13-probe.config.ts']
  const hashes = Object.fromEntries(paths.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]))
  await writeFile(new URL(`./unit13-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, import.meta.url), JSON.stringify({ node: process.version, cases, hashes }, null, 2) + '\n')
})
