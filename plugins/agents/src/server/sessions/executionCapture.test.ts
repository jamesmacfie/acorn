import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import { AgentStore } from './store'

it('freezes target-turn capture while another connection appends to an ongoing turn', async () => {
  const fixture = makeTestPluginDb('agents')
  const store = new AgentStore(fixture.db, {} as CoreServices)
  const other = fixture.openConnection()
  const prepare = fixture.db.$client.prepare.bind(fixture.db.$client)
  try {
    fixture.db.$client.prepare(`INSERT INTO agent_sessions (id,task_id,provider_id,profile_id,kind,driver_kind,driver_version,controller,runtime_state,attention,status_authority,title,config_json,created_at,updated_at) VALUES ('target','task','fake','fake','workflow','acp','test','acorn','ready','none','protocol','Synthetic','{}',0,0)`).run()
    const enqueue = (key: string) => store.enqueueTurn('target', { input: [], source: 'workflow', effectivePolicy: {}, idempotencyKey: key })
    const first = (await enqueue('first')).turn
    await store.startTurn(first.id)
    for (let n = 0; n < 501; n++) await store.recordEvent('target', first.id, { type: 'diagnostic', level: 'info', message: 'progress' })
    await store.recordEvent('target', first.id, { type: 'assistant_message', text: 'complete' })
    await store.recordEvent('target', first.id, { type: 'turn_completed' })
    const second = (await enqueue('second')).turn
    await store.startTurn(second.id)
    const last = await store.recordEvent('target', second.id, { type: 'assistant_message', text: 'ongoing' })
    await store.flushSearch()
    let mutated = false
    fixture.db.$client.prepare = (query: string) => {
      if (query.includes('"agent_events"') && query.includes('order by') && query.includes('limit') && !mutated) {
        mutated = true
        other.insert(schema.agentEvents).values({ id: randomUUID(), sessionId: 'target', turnId: second.id,
          seq: last.seq + 1, schemaVersion: 1, eventJson: JSON.stringify({ type: 'assistant_message', text: 'later', append: true }), createdAt: Date.now() }).run()
        other.update(schema.agentSessions).set({ lastEventSeq: last.seq + 1 }).where(sql`id = 'target'`).run()
      }
      return prepare(query)
    }
    const capture = await store.executionSnapshot('target', [first.id, second.id])
    expect(mutated).toBe(true)
    expect(capture.session.lastEventSeq).toBe(last.seq)
    expect(capture.events).toHaveLength(last.seq)
    expect(capture.events.at(-1)?.event).toEqual({ type: 'assistant_message', text: 'ongoing' })
    expect((await store.executionSnapshot('target', [second.id])).events.at(-1)?.event)
      .toEqual({ type: 'assistant_message', text: 'later', append: true })
    expect(capture.turns.map((turn) => turn.status)).toEqual(['completed', 'active'])
  } finally { fixture.db.$client.prepare = prepare; other.close(); fixture.cleanup() }
})
