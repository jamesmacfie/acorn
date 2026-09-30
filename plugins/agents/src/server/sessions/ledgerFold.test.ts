// The ledger fold against a real migrated database: a tool call or file change keeps its opening row
// and one row with its latest state, and every reader still draws the card it drew when each update
// had a row of its own. The reference in each test is what the old ledger held: every record exactly
// as recordEvent returned it, which is also what the socket carries.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq, sql } from 'drizzle-orm'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentEventRecord, AgentNormalizedEvent, AgentProviderDescriptor, AgentToolCall } from '../../contract/wire.ts'
import { agentEventSearchText } from '../../contract/wire.ts'
import * as schema from '../../node/schema'
import { buildConversationItems } from '../../client/sessions/conversationItems'
import { mergeManagedSnapshot } from '../../client/sessions/managedSnapshot'
import { foldToolEvents } from '../../shared/toolFold'
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

// A command the way Codex reports one: opened, output streamed as appends, then the status.
const COMMAND: AgentNormalizedEvent[] = [
  tool({ id: 'call-1', title: 'Run tests', kind: 'execute', status: 'pending', input: 'pnpm test' }),
  tool({ id: 'call-1', output: 'first line\n', outputAppend: true, status: 'running' }),
  tool({ id: 'call-1', output: 'second line\n', outputAppend: true }),
  tool({ id: 'call-1', status: 'completed' }),
]

describe('ledger fold', () => {
  let ctx: TestNodeContext
  let db: ReturnType<TestNodeContext['storage']['open']>
  let store: AgentStore
  let sessionId: string
  let frames: AgentEventRecord[]

  beforeEach(async () => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    db = ctx.storage.open()
    store = new AgentStore(db, ctx.core)
    sessionId = (await store.createSession({
      taskId: randomUUID(),
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    }, PROVIDER)).id
    frames = []
  })

  afterEach(() => {
    ctx.cleanup()
  })

  const record = async (turnId: string | null, event: AgentNormalizedEvent, into: AgentStore = store) => {
    frames.push(await into.recordEvent(sessionId, turnId, event))
  }
  const stored = () => db.select().from(schema.agentEvents)
    .where(eq(schema.agentEvents.sessionId, sessionId)).orderBy(asc(schema.agentEvents.seq)).all()
  const drawn = (events: AgentEventRecord[]) => buildConversationItems(events)
  const ledger = async () => (await store.exportSnapshot(sessionId)).events

  it('stores a call with several updates as its opener and its latest state', async () => {
    const turn = randomUUID()
    await record(turn, { type: 'user_message', text: 'Run the tests.' })
    await record(turn, COMMAND[0]!)
    await record(turn, { type: 'assistant_message', text: 'Running them now.' })
    for (const event of COMMAND.slice(1)) await record(turn, event)

    const rows = stored()
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 6])
    const [opener, latest] = rows.filter((row) => JSON.parse(row.eventJson).type === 'tool')
    expect(opener!.id).toBe(frames[1]!.id)
    expect(JSON.parse(opener!.eventJson)).toEqual(COMMAND[0])
    expect(JSON.parse(latest!.eventJson)).toEqual({
      type: 'tool',
      tool: {
        id: 'call-1',
        title: 'Run tests',
        kind: 'execute',
        status: 'completed',
        input: 'pnpm test',
        output: 'first line\nsecond line\n',
      },
    })
    // Indexed once, on the latest row, which carries the whole call.
    expect(opener!.searchText).toBeNull()
    expect(latest!.searchText).toContain('second line')
    expect((await store.requireSession(sessionId)).lastEventSeq).toBe(6)
    expect(drawn(await ledger())).toEqual(drawn(frames))
  })

  it('hands every update to the socket as the provider reported it', async () => {
    const turn = randomUUID()
    for (const event of COMMAND) await record(turn, event)
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2, 3, 4])
    expect(frames.map((frame) => frame.event)).toEqual(COMMAND)
  })

  it('brings a reader that resumes after its mark to the final state', async () => {
    const turn = randomUUID()
    await record(turn, { type: 'user_message', text: 'Run the tests.' })
    await record(turn, COMMAND[0]!)
    await record(turn, COMMAND[1]!)
    // A client loads here and holds everything through the mark.
    const held = await store.snapshot(sessionId, 0, 2_000)
    const mark = held.session.lastEventSeq
    // It hears the next update, misses the one after, and hears the last. Its mark stays at the gap.
    await record(turn, COMMAND[2]!)
    const heard = [frames.at(-1)!]
    await record(turn, { type: 'assistant_message', text: 'Almost done.' })
    await record(turn, COMMAND[3]!)
    heard.push(frames.at(-1)!)
    const live = mergeManagedSnapshot(undefined, { ...held, events: [...held.events, ...heard] })
    const resumed = mergeManagedSnapshot(live, await store.snapshot(sessionId, mark, 2_000))

    expect(drawn(resumed.events)).toEqual(drawn(frames))
    // A reader from the start, and one that folds its pages on the node (`fold=1`), agree.
    expect(drawn((await store.snapshot(sessionId, 0, 2_000)).events)).toEqual(drawn(frames))
    expect(drawn(foldToolEvents((await store.snapshot(sessionId, 0, 2_000)).events))).toEqual(drawn(frames))
    // Every page after the mark ends at the session's last sequence, so the walk stops where it should.
    expect((await store.eventPage(sessionId, mark)).events.at(-1)?.seq).toBe(resumed.session.lastEventSeq)
  })

  it('keeps the search index in step and still finds the call', async () => {
    const turn = randomUUID()
    for (const event of COMMAND) await record(turn, event)
    const fts = db.all<{ eventId: string }>(sql`SELECT event_id AS eventId FROM agent_events_fts WHERE session_id = ${sessionId}`)
    const indexed = stored().filter((row) => row.searchText !== null).map((row) => row.id)
    expect(fts.map((row) => row.eventId)).toEqual(indexed)
    expect(indexed).toHaveLength(1)
    expect((await store.searchSessions('second line')).map((session) => session.id)).toEqual([sessionId])
    expect((await store.searchSessions('pnpm')).map((session) => session.id)).toEqual([sessionId])
  })

  it('folds a call that was running when the node stopped', async () => {
    const turn = randomUUID()
    await record(turn, COMMAND[0]!)
    await record(turn, COMMAND[1]!)
    // A new process holds nothing, so it reads the turn's cards back from the ledger.
    const restarted = new AgentStore(db, ctx.core)
    await record(turn, COMMAND[2]!, restarted)
    await record(turn, COMMAND[3]!, restarted)
    expect(stored()).toHaveLength(2)
    expect(drawn(await ledger())).toEqual(drawn(frames))
  })

  it('folds every row of a call stored before the fold existed', async () => {
    const turn = randomUUID()
    // The old ledger: one row per update, each with its own search text.
    for (const [index, event] of COMMAND.slice(0, 3).entries()) {
      const row = {
        id: randomUUID(), sessionId, turnId: turn, seq: index + 1, schemaVersion: 1,
        eventJson: JSON.stringify(event), searchText: agentEventSearchText(event), createdAt: index,
      }
      db.insert(schema.agentEvents).values(row).run()
      frames.push({ ...row, event, searchText: row.searchText })
    }
    db.update(schema.agentSessions).set({ lastEventSeq: 3 }).where(eq(schema.agentSessions.id, sessionId)).run()
    const restarted = new AgentStore(db, ctx.core)
    await record(turn, COMMAND[3]!, restarted)
    expect(stored().map((row) => row.seq)).toEqual([1, 4])
    expect(drawn(await ledger())).toEqual(drawn(frames))
  })

  it('folds a call per turn, as the transcript does', async () => {
    const first = randomUUID()
    const second = randomUUID()
    await record(first, tool({ id: 'item-1', title: 'Read', status: 'running' }))
    await record(second, tool({ id: 'item-1', title: 'Read again', status: 'running' }))
    await record(second, tool({ id: 'item-1', status: 'completed' }))
    await record(first, tool({ id: 'item-1', status: 'completed' }))
    expect(stored().map((row) => row.seq)).toEqual([1, 2, 3, 4])
    await record(first, tool({ id: 'item-1', output: 'late' }))
    expect(stored().map((row) => row.seq)).toEqual([1, 2, 3, 5])
    expect(drawn(await ledger())).toEqual(drawn(frames))
  })

  it('keeps the opener and latest report of a file change, and leaves one without a change id alone', async () => {
    const turn = randomUUID()
    const change = (patch: string, changeId?: string): AgentNormalizedEvent =>
      ({ type: 'file_change', path: 'src/a.ts', patch, summary: 'Updated a file.', ...(changeId ? { changeId } : {}) })
    await record(turn, change('@@ -1 +1 @@\n-a\n+b', 'edit-1'))
    await record(turn, change('@@ -1 +1 @@\n-a\n+c', 'edit-1'))
    await record(turn, change('@@ -1 +1 @@\n-a\n+d', 'edit-1'))
    await record(turn, change('@@ -1 +1 @@\n-x\n+y'))
    await record(turn, change('@@ -1 +1 @@\n-x\n+z'))
    const rows = stored()
    expect(rows.map((row) => row.seq)).toEqual([1, 3, 4, 5])
    expect(JSON.parse(rows[1]!.eventJson)).toEqual(change('@@ -1 +1 @@\n-a\n+d', 'edit-1'))
    expect(rows[0]!.searchText).toBeNull()
    expect(drawn(await ledger())).toEqual(drawn(frames))
  })

  it('forgets a deleted session', async () => {
    const turn = randomUUID()
    await record(turn, COMMAND[0]!)
    await store.deleteSession(sessionId)
    expect(stored()).toEqual([])
    expect(db.all(sql`SELECT rowid FROM agent_events_fts`)).toEqual([])
  })
})
