// The facts writer and the backfill pass against this plugin's own migrated database
// (docs/managed-agents/turn-facts.md).
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import * as schema from '../../node/schema'
import { seedLargeSession } from '../../testkit/largeSession'
import { AgentStore } from './store'
import type { TurnFacts } from './turnFacts'
import { backfillTurnFacts } from './turnFactsBackfill'
import { TurnFactsWriter, turnEventsQuery, writeTurnFacts } from './turnFactsWriter'

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

describe('turn facts', () => {
  let ctx: TestNodeContext
  let db: ReturnType<TestNodeContext['storage']['open']>

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    db = ctx.storage.open()
  })
  afterEach(() => ctx.cleanup())

  const facts = (turnId: string) =>
    db.select().from(schema.agentTurnFacts).where(eq(schema.agentTurnFacts.turnId, turnId)).get()

  // A session, and a turn of it that has started.
  const startedTurn = async (store: AgentStore) => {
    const session = await store.createSession(
      { taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', title: 'S', config: {} },
      PROVIDER,
    )
    const { turn } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Run the tests.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    return { sessionId: session.id, turnId: turn.id }
  }

  it("reads only its turn's events, through the turn index", async () => {
    const store = new AgentStore(db, ctx.core)
    const earlier = await startedTurn(store)
    // Ten thousand earlier events in the same session.
    db.transaction((tx) => {
      for (let seq = 1; seq <= 10_000; seq++)
        tx.insert(schema.agentEvents)
          .values({
            id: randomUUID(),
            sessionId: earlier.sessionId,
            turnId: earlier.turnId,
            seq,
            schemaVersion: 1,
            eventJson: JSON.stringify({ type: 'tool', tool: { id: `old-${seq}`, title: 'Read', status: 'failed' } }),
            createdAt: Date.now(),
          })
          .run()
      tx.update(schema.agentSessions)
        .set({ lastEventSeq: 10_000 })
        .where(eq(schema.agentSessions.id, earlier.sessionId))
        .run()
    })
    await store.recordEvent(earlier.sessionId, earlier.turnId, { type: 'turn_completed' })
    const { turn } = await store.enqueueTurn(earlier.sessionId, {
      input: [{ type: 'text', text: 'Again.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    await store.recordEvent(earlier.sessionId, turn.id, { type: 'user_message', text: 'Again.' })
    await store.recordEvent(earlier.sessionId, turn.id, {
      type: 'tool',
      tool: { id: 'new', title: 'Bash', kind: 'execute', input: 'pnpm test', status: 'completed', exitCode: 1 },
    })
    await store.recordEvent(earlier.sessionId, turn.id, { type: 'turn_completed' })

    expect(turnEventsQuery(db, turn.id).all()).toHaveLength(3)
    const plan = db
      .all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${turnEventsQuery(db, turn.id).getSQL()}`)
      .map((step) => step.detail)
    expect(plan).toEqual(['SEARCH agent_events USING INDEX agent_events_turn_seq_idx (turn_id=?)'])

    const row = db.transaction((tx) => writeTurnFacts(tx, turn.id, 'project'))
    expect(row).toMatchObject({ firstSeq: 10_002, toolCalls: 1, toolFailures: 1, projectId: 'project' })
    expect(facts(turn.id)).toEqual(row)
  })

  it('writes the facts of a turn when it settles, then says so', async () => {
    const said: Array<{ turnId: string; stored: boolean }> = []
    let writer: TurnFactsWriter | null = null
    const store = new AgentStore(db, ctx.core, undefined, (turnId) => writer!.enqueue(turnId))
    writer = new TurnFactsWriter({
      db,
      projectOf: async () => 'project',
      written: (row: TurnFacts) => said.push({ turnId: row.turnId, stored: facts(row.turnId) !== undefined }),
    })
    const { sessionId, turnId } = await startedTurn(store)
    await store.recordEvent(sessionId, turnId, { type: 'assistant_message', text: 'Done.' })
    await writer.idle()
    expect(facts(turnId)).toBeUndefined()

    await store.recordEvent(sessionId, turnId, { type: 'turn_completed' })
    await writer.idle()
    expect(facts(turnId)).toMatchObject({ status: 'completed', projectId: 'project', toolCalls: 0 })
    expect(said).toEqual([{ turnId, stored: true }])
  })

  it('writes a turn of the canonical session in under 20 ms at the 95th percentile', async () => {
    await seedLargeSession(db, ctx.core, { taskId: randomUUID(), profile: 'canonical' })
    const largest = db.get<{ turnId: string; events: number }>(sql`
      SELECT turn_id AS turnId, count(*) AS events FROM agent_events
      WHERE turn_id IS NOT NULL GROUP BY turn_id ORDER BY events DESC LIMIT 1
    `)!
    const times: number[] = []
    for (let run = 0; run < 100; run++) {
      const started = performance.now()
      db.transaction((tx) => writeTurnFacts(tx, largest.turnId, null))
      times.push(performance.now() - started)
    }
    times.sort((left, right) => left - right)
    expect(times[94]).toBeLessThan(20)
  }, 60_000)

  it('fills in finished turns that have no facts, and rewrites rows an older version wrote', async () => {
    const { session } = await seedLargeSession(db, ctx.core, { taskId: randomUUID(), profile: 'small' })
    const turns = db
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, session.id))
      .all()
    expect(turns.length).toBeGreaterThan(10)
    // A turn still queued has nothing to count.
    const store = new AgentStore(db, ctx.core)
    const { turn: queued } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Later.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    const projectOf = async () => 'project'

    const first = await backfillTurnFacts(db, { projectOf, batch: 4 })
    expect(first.turns).toBe(turns.length)
    expect(first.steps).toBeGreaterThanOrEqual(Math.ceil(turns.length / 4))
    for (const { id } of turns) expect(facts(id)).toMatchObject({ projectId: 'project', status: 'completed' })
    expect(facts(queued.id)).toBeUndefined()

    db.update(schema.agentTurnFacts).set({ version: 0 }).where(eq(schema.agentTurnFacts.turnId, turns[3]!.id)).run()
    expect((await backfillTurnFacts(db, { projectOf, batch: 4 })).turns).toBe(1)
    expect((await backfillTurnFacts(db, { projectOf, batch: 4 })).turns).toBe(0)
  })
})
