// The two command reads against a real migrated ledger: what they return, and which index they use.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor, AgentToolCall } from '../../contract/wire.ts'
import {
  commandTurn,
  type CommandScope,
  commandTurnQuery,
  unfinishedCommands,
  unfinishedCommandsQuery,
} from './commandLifecycle'
import { AgentStore } from './store'

const PROVIDER: AgentProviderDescriptor = {
  id: 'fake',
  profileId: 'fake',
  label: 'Fake',
  driverKind: 'acp',
  driverVersion: '1',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

let ctx: TestNodeContext
let store: AgentStore
beforeEach(() => {
  ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
  store = new AgentStore(ctx.storage.open(), ctx.core)
})
afterEach(() => ctx.cleanup())

const newSession = async () =>
  (
    await store.createSession(
      { taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
      PROVIDER,
    )
  ).id
const newTurn = async (sessionId: string) => {
  const { turn } = await store.enqueueTurn(sessionId, {
    input: [{ type: 'text', text: 'go' }],
    source: 'interactive',
    effectivePolicy: {},
    idempotencyKey: randomUUID(),
  })
  return turn.id
}
const tool = (call: Partial<AgentToolCall> & { id: string }) => ({
  type: 'tool' as const,
  tool: { title: '', kind: 'execute' as const, ...call },
})
const readUnfinished = (scope: CommandScope) => ctx.storage.open().transaction((tx) => unfinishedCommands(tx, scope))
const plan = (query: ReturnType<typeof sql>) =>
  ctx.storage
    .open()
    .all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query}`)
    .map((row) => row.detail)
    .join('\n')

/** The settle read as it was written with `json_extract`, which no index covered. */
const legacyUnfinished = (sessionId: string) =>
  ctx.storage.open().all<{ id: string; seq: number }>(sql`
    WITH commands AS (
      SELECT session_id, min(seq) AS opener,
        coalesce(max(CASE WHEN json_extract(event_json, '$.tool.status') IS NOT NULL THEN seq END), max(seq)) AS seq
      FROM agent_events
      WHERE json_extract(event_json, '$.type') = 'tool' AND session_id = ${sessionId}
      GROUP BY session_id, turn_id, json_extract(event_json, '$.tool.id')
      HAVING max(json_extract(event_json, '$.tool.kind') = 'execute')
    )
    SELECT e.id, e.seq FROM agent_events e JOIN commands c ON e.session_id = c.session_id AND e.seq = c.seq
    WHERE json_extract(e.event_json, '$.tool.status') IN ('pending', 'running')
      OR json_extract(e.event_json, '$.tool.status') IS NULL
    ORDER BY e.session_id, e.seq
  `)

it('settles the same commands the json_extract read did, and one turn narrows to its own', async () => {
  const sessionId = await newSession()
  const [first, second] = [await newTurn(sessionId), await newTurn(sessionId)]
  for (let index = 0; index < 40; index++) {
    const turnId = index % 2 ? first : second
    await store.recordEvent(sessionId, turnId, { type: 'assistant_message', text: `line ${index}` })
    await store.recordEvent(sessionId, turnId, tool({ id: `done-${index}`, status: 'running' }))
    if (index % 3) await store.recordEvent(sessionId, turnId, tool({ id: `done-${index}`, status: 'completed' }))
  }
  await store.recordEvent(sessionId, first, tool({ id: 'read', kind: 'read', status: 'running' }))

  const all = readUnfinished({ sessionId })
  expect(all.length).toBeGreaterThan(5)
  expect(all.map(({ id, seq }) => ({ id, seq }))).toEqual(legacyUnfinished(sessionId))
  const narrowed = readUnfinished({ sessionId, turnId: first })
  expect(narrowed.length).toBeGreaterThan(0)
  expect(narrowed).toEqual(all.filter((record) => record.turnId === first))
})

it('settles a session through the tool index', () => {
  expect(plan(unfinishedCommandsQuery({ sessionId: 's' }))).toContain('agent_events_session_tool_idx')
})

it('finds the owner of a late update through the tool index', async () => {
  const sessionId = await newSession()
  const turnId = await newTurn(sessionId)
  await store.recordEvent(sessionId, turnId, tool({ id: 'cmd', status: 'running' }))
  expect(ctx.storage.open().transaction((tx) => commandTurn(tx, sessionId, { id: 'cmd', title: '' }))).toBe(turnId)
  expect(plan(commandTurnQuery(sessionId, { id: 'cmd', title: '' }))).toContain('agent_events_session_tool_idx')
})
