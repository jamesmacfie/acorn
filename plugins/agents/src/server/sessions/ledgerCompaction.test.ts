// The background pass over rows stored before the ledger fold, against a real migrated database. The
// ledger here is written the old way, one row per update, so the pass has something to do.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq, sql } from 'drizzle-orm'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentEventRecord, AgentNormalizedEvent, AgentProviderDescriptor } from '../../contract/wire.ts'
import { agentEventSearchText } from '../../contract/wire.ts'
import * as schema from '../../node/schema'
import { buildConversationItems } from '../../client/sessions/conversationItems'
import { compactLedgers } from './ledgerCompaction'
import { mapAgentEvent } from './rowMapping'
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

// Small enough that every step boundary is crossed: the scan pages, the write batches, a card in one.
const STEPS = { scanRows: 3, writeRows: 2, mergePages: 5 }

describe('ledger compaction', () => {
  let ctx: TestNodeContext
  let db: ReturnType<TestNodeContext['storage']['open']>
  let store: AgentStore

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    db = ctx.storage.open()
    store = new AgentStore(db, ctx.core)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // A session whose ledger was written one row per update, the way it was before the fold.
  const oldSession = async (events: Array<[turnId: string | null, event: AgentNormalizedEvent]>) => {
    const { id } = await store.createSession({
      taskId: randomUUID(),
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    }, PROVIDER)
    for (const [index, [turnId, event]] of events.entries()) {
      db.insert(schema.agentEvents).values({
        id: randomUUID(), sessionId: id, turnId, seq: index + 1, schemaVersion: 1,
        eventJson: JSON.stringify(event), searchText: agentEventSearchText(event), createdAt: index,
      }).run()
    }
    db.update(schema.agentSessions).set({ lastEventSeq: events.length }).where(eq(schema.agentSessions.id, id)).run()
    return id
  }
  const rows = (sessionId: string) => db.select().from(schema.agentEvents)
    .where(eq(schema.agentEvents.sessionId, sessionId)).orderBy(asc(schema.agentEvents.seq)).all()
  const drawn = (sessionId: string) => buildConversationItems(rows(sessionId).map(mapAgentEvent))

  const turn = randomUUID()
  const other = randomUUID()
  const LEDGER: Array<[string | null, AgentNormalizedEvent]> = [
    [turn, { type: 'user_message', text: 'Fix the build.' }],
    [turn, { type: 'tool', tool: { id: 'cmd', title: 'Build', status: 'pending', input: 'pnpm build' } }],
    [turn, { type: 'usage', usage: { inputTokens: 10 } }],
    [turn, { type: 'tool', tool: { id: 'cmd', title: '', output: 'compiling\n', outputAppend: true, status: 'running' } }],
    [turn, { type: 'assistant_message', text: 'Building.' }],
    [turn, { type: 'tool', tool: { id: 'cmd', title: '', output: 'error TS2322\n', outputAppend: true } }],
    [turn, { type: 'file_change', path: 'a.ts', patch: '@@ -1 +1 @@\n-a\n+b', changeId: 'cmd' }],
    [turn, { type: 'file_change', path: 'a.ts', patch: '@@ -1 +1 @@\n-a\n+c', changeId: 'cmd' }],
    [turn, { type: 'file_change', path: 'a.ts', patch: '@@ -1 +1 @@\n-a\n+d', changeId: 'cmd' }],
    [turn, { type: 'file_change', summary: 'Codex updated files.' }],
    [turn, { type: 'file_change', summary: 'Codex updated files.' }],
    [turn, { type: 'tool', tool: { id: 'cmd', title: '', status: 'failed' } }],
    [other, { type: 'tool', tool: { id: 'cmd', title: 'Build again', status: 'running' } }],
    [null, { type: 'tool', tool: { id: 'late', title: 'Background', status: 'running' } }],
    [null, { type: 'tool', tool: { id: 'late', title: '', status: 'completed', output: 'done' } }],
    [turn, { type: 'usage', usage: { outputTokens: 5 } }],
    [turn, { type: 'turn_completed', stopReason: 'end_turn' }],
  ]

  it('keeps each card’s opener and newest row, folded, and leaves every other row alone', async () => {
    const sessionId = await oldSession(LEDGER)
    const before = rows(sessionId)
    const drawnBefore = drawn(sessionId)

    const totals = await compactLedgers(db, { steps: STEPS })
    expect(totals).toEqual({ sessions: 1, deleted: 3, rewritten: 2 })

    const after = rows(sessionId)
    // Gone: the two middle updates of `cmd` and the middle report of the file change. The session's
    // last row, and so the sequence a reader pages to, stays.
    expect(before.filter((row) => !after.some((kept) => kept.id === row.id)).map((row) => row.seq)).toEqual([4, 6, 8])
    expect(after.at(-1)!.seq).toBe(LEDGER.length)
    const byId = new Map(before.map((row) => [row.id, row]))
    const folded = after.find((row) => row.seq === 12)!
    expect(JSON.parse(folded.eventJson)).toEqual({
      type: 'tool',
      tool: { id: 'cmd', title: 'Build', status: 'failed', input: 'pnpm build', output: 'compiling\nerror TS2322\n' },
    })
    expect(folded.searchText).toContain('error TS2322')
    // Openers keep their event but not their search text. Nothing else changed at all.
    for (const row of after) {
      if (row.seq === 12 || row.seq === 15) continue
      const was = byId.get(row.id)!
      expect(row.eventJson).toBe(was.eventJson)
      expect(row.searchText).toBe([2, 7, 14].includes(row.seq) ? null : was.searchText)
    }
    expect(drawn(sessionId)).toEqual(drawnBefore)

    const fts = db.all<{ eventId: string }>(sql`SELECT event_id AS eventId FROM agent_events_fts ORDER BY rowid`)
    expect(fts.map((row) => row.eventId)).toEqual(after.filter((row) => row.searchText !== null).map((row) => row.id))
    expect((await store.searchSessions('TS2322')).map((session) => session.id)).toEqual([sessionId])
  })

  it('does nothing the second time, even for a session unmarked by hand', async () => {
    const sessionId = await oldSession(LEDGER)
    await compactLedgers(db, { steps: STEPS })
    const once = rows(sessionId)
    expect(await compactLedgers(db, { steps: STEPS })).toEqual({ sessions: 0, deleted: 0, rewritten: 0 })
    db.update(schema.agentSessions).set({ ledgerCompactedAt: null }).run()
    expect(await compactLedgers(db, { steps: STEPS })).toEqual({ sessions: 1, deleted: 0, rewritten: 0 })
    expect(rows(sessionId)).toEqual(once)
  })

  it('stops when asked and leaves the session for the next pass', async () => {
    const sessionId = await oldSession(LEDGER)
    const controller = new AbortController()
    controller.abort()
    expect(await compactLedgers(db, { steps: STEPS, signal: controller.signal })).toEqual({ sessions: 0, deleted: 0, rewritten: 0 })
    expect(rows(sessionId)).toHaveLength(LEDGER.length)
    expect(db.select().from(schema.agentSessions).all()[0]!.ledgerCompactedAt).toBeNull()
  })

  it('leaves a session to the live fold once an update reached a card it scanned', async () => {
    const sessionId = await oldSession(LEDGER)
    // An update recorded now folds `cmd` itself, so the pass finds that card's rows gone and skips it.
    const frames: AgentEventRecord[] = rows(sessionId).map(mapAgentEvent)
    frames.push(await store.recordEvent(sessionId, turn, { type: 'tool', tool: { id: 'cmd', title: '', output: 'retrying\n', outputAppend: true } }))
    await compactLedgers(db, { steps: STEPS })
    expect(rows(sessionId).filter((row) => JSON.parse(row.eventJson).tool?.id === 'cmd' && row.turnId === turn).map((row) => row.seq))
      .toEqual([2, LEDGER.length + 1])
    expect(drawn(sessionId)).toEqual(buildConversationItems(frames))
  })
})
