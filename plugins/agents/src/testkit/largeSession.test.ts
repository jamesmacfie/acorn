import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { createConversationProjection, visibleConversationItems } from '../client/sessions/conversationItems'
import { AgentStore } from '../server/sessions/store'
import { LARGE_SESSION_OLDEST_MARKER, largeSessionTurns, seedLargeSession } from './largeSession'

// The long session behind the large-surface fixture, written through this plugin's own store against
// its own migrated database, then read back the way the client reads it.

describe('the generated session ledger', () => {
  it('is the same from the same seed, and the canonical profile is the 7,000-event session', () => {
    expect(largeSessionTurns('small', 1)).toEqual(largeSessionTurns('small', 1))
    const events = largeSessionTurns('canonical', 1).reduce((total, turn) => total + turn.events.length, 0)
    expect(events).toBeGreaterThanOrEqual(7_000)
    expect(events).toBeLessThan(7_100)
  })
})

describe('seeding a large session', () => {
  let ctx: TestNodeContext
  beforeEach(() => { ctx = makeTestNodeContext({ plugin: { name: 'agents' } }) })
  afterEach(() => ctx.cleanup())

  it('writes real session, turn, event and request rows that settle and page like a live run', async () => {
    const db = ctx.storage.open()
    const seeded = await seedLargeSession(db, ctx.core, { taskId: randomUUID(), profile: 'small' })
    const store = new AgentStore(db, ctx.core)

    const snapshot = await store.exportSnapshot(seeded.session.id)
    expect(snapshot.events).toHaveLength(seeded.events)
    expect(snapshot.turns).toHaveLength(seeded.turns)
    expect(snapshot.turns.every((turn) => turn.status === 'completed')).toBe(true)
    expect(snapshot.requests.length).toBeGreaterThan(0)
    expect(snapshot.requests.every((request) => request.status === 'resolved')).toBe(true)
    expect(snapshot.session.runtimeState).toBe('stopped')
    // Nothing for a booting node to recover.
    expect((await store.unsettledSessions()).map((session) => session.id)).not.toContain(seeded.session.id)

    // Paged the way `loadSnapshot` walks it.
    const first = await store.snapshot(seeded.session.id, 0, 100)
    expect(first.events).toHaveLength(100)
    const rest = await store.snapshot(seeded.session.id, first.events.at(-1)!.seq, 2_000)
    expect(first.events.length + rest.events.length).toBe(seeded.events)

    // What the transcript projects from it: the small profile's hundred-odd cards, oldest first.
    const requests = new Map(snapshot.requests.map((request) => [request.providerRequestId, request]))
    const items = visibleConversationItems(createConversationProjection()(snapshot.events), (id) => requests.get(id))
    expect(items.length).toBeGreaterThan(100)
    expect(items.length).toBeLessThan(160)
    const oldest = items[0]!.event
    expect(oldest.type === 'user_message' && oldest.text).toContain(LARGE_SESSION_OLDEST_MARKER)
  })
})
