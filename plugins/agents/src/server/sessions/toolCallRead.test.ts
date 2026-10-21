// Reading one tool call by its ID, against a real migrated ledger.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentNormalizedEvent, AgentProviderDescriptor, AgentToolCall } from '../../contract/wire.ts'
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

const tool = (call: Partial<AgentToolCall> & { id: string }): AgentNormalizedEvent => ({
  type: 'tool',
  tool: { title: '', ...call },
})
const opener = tool({
  id: 'call-1',
  name: 'panel_show',
  title: 'Show a panel',
  status: 'pending',
  input: '{"title":"PRs"}',
})
const result = tool({ id: 'call-1', status: 'completed', output: '{"panelId":"prs","shownAt":1,"description":[]}' })

let ctx: TestNodeContext
let store: AgentStore
let taskId: string
let sessionId: string
const newSession = async () =>
  (
    await store.createSession(
      { taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
      PROVIDER,
    )
  ).id

beforeEach(async () => {
  ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
  store = new AgentStore(ctx.storage.open(), ctx.core)
  taskId = randomUUID()
  sessionId = await newSession()
})
afterEach(() => ctx.cleanup())

it('folds a call whose rows fit in one page', async () => {
  await store.recordEvent(sessionId, null, opener)
  await store.recordEvent(sessionId, null, result)
  expect(await store.toolCall(sessionId, 'call-1')).toEqual({
    tool: expect.objectContaining({
      id: 'call-1',
      name: 'panel_show',
      status: 'completed',
      input: '{"title":"PRs"}',
      output: '{"panelId":"prs","shownAt":1,"description":[]}',
    }),
    turnId: null,
    taskId,
  })
})

it('folds a call whose opener and result are pages apart', async () => {
  await store.recordEvent(sessionId, null, opener)
  for (let index = 0; index < 30; index++)
    await store.recordEvent(sessionId, null, { type: 'assistant_message', text: `line ${index}` })
  await store.recordEvent(sessionId, null, result)
  const page = await store.clientEventPage(sessionId, 0, 10)
  expect(page.events.some((record) => record.event.type === 'tool' && record.event.tool.status === 'completed')).toBe(
    false,
  )
  const read = await store.toolCall(sessionId, 'call-1')
  expect(read?.tool).toMatchObject({ name: 'panel_show', status: 'completed', input: '{"title":"PRs"}' })
})

it("answers null for another session's call and for a call that doesn't exist", async () => {
  const other = await newSession()
  await store.recordEvent(other, null, opener)
  expect(await store.toolCall(sessionId, 'call-1')).toBeNull()
  expect(await store.toolCall(sessionId, 'missing')).toBeNull()
  await expect(store.toolCall('no-such-session', 'call-1')).rejects.toThrow(/not found/)
})

it('reads the call through its index', () => {
  const plan = ctx.storage.open().all<{ detail: string }>(
    sql`EXPLAIN QUERY PLAN SELECT turn_id FROM agent_events
        WHERE session_id = 's' AND event_json ->> '$.tool.id' = 'call-1' AND event_json ->> '$.type' = 'tool'`,
  )
  expect(plan.map((row) => row.detail).join('\n')).toContain('agent_events_session_tool_idx')
})
