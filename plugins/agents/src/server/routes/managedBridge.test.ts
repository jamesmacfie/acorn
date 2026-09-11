// The usage fold, at the seam it happens on, against a real migrated database.
//
// The rule itself is unit-tested in ../../shared/usageFold.test.ts. What only a database can answer is
// that the HTTP snapshot a client reads is folded while the ledger every other reader goes through is
// not: pricing, the usage settings page and workflow execution all count the rows.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import { AgentStore } from '../sessions/store'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { managedAgentsBridge } from './managedBridge'

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

describe('the snapshot a client reads', () => {
  let ctx: TestNodeContext
  let store: AgentStore

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    store = new AgentStore(ctx.storage.open(), ctx.core)
  })
  afterEach(() => ctx.cleanup())

  // Only `store` is reached on this path, so the bridge is built over it rather than over a whole
  // runtime with a driver, a registry and a temporary worktree behind it.
  const bridge = () => managedAgentsBridge({ store } as unknown as ManagedAgentRuntime)

  it('carries one usage row a turn, and the ledger still holds every one', async () => {
    const session = await store.createSession({
      taskId: randomUUID(),
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    }, PROVIDER)
    const turn = await store.enqueueTurn(session.id, {
      source: 'interactive',
      input: [{ type: 'text', text: 'go' }],
      effectivePolicy: {},
      idempotencyKey: 'k1',
    })
    await store.recordEvent(session.id, turn.id, { type: 'user_message', text: 'go' })
    // 58 updates in one turn is what this machine's database averages: `usage` is a quarter of 66,264
    // events across 114 sessions.
    for (let at = 1; at <= 58; at++) {
      await store.recordEvent(session.id, turn.id, { type: 'usage', usage: { contextUsed: at * 100, inputTokens: at } })
    }

    const projected = await bridge().snapshot(session.id)
    const usage = projected.events.filter((event) => event.event.type === 'usage')
    expect(usage).toHaveLength(1)
    expect(usage[0].event).toEqual({ type: 'usage', usage: { contextUsed: 5_800, inputTokens: 58 } })
    // Everything else survives untouched, in seq order.
    expect(projected.events.filter((event) => event.event.type === 'user_message')).toHaveLength(1)
    const seqs = projected.events.map((event) => event.seq)
    expect(seqs.every((seq, at) => at === 0 || seq > seqs[at - 1])).toBe(true)

    const ledger = await store.exportSnapshot(session.id)
    expect(ledger.events.filter((event) => event.event.type === 'usage')).toHaveLength(58)
    // The store's own read is unfolded too: workflow execution builds a turn's usage capture from it.
    const raw = await store.snapshot(session.id)
    expect(raw.events.filter((event) => event.event.type === 'usage')).toHaveLength(58)
    const page = await store.eventPage(session.id)
    expect(page.events.filter((event) => event.event.type === 'usage')).toHaveLength(58)
  })

  it('projects delegation visibility onto the bounded session list', async () => {
    const session = await store.createSession({
      taskId: randomUUID(),
      providerId: 'fake',
      profileId: 'fake',
      kind: 'delegated',
      config: {},
    }, PROVIDER)
    const projectSessionList = async (page: Awaited<ReturnType<AgentStore['listSessions']>>) => ({
      ...page,
      delegations: [{
        sessionId: session.id,
        depth: 1,
        isolation: 'shared' as const,
        owner: { kind: 'managed' as const, parentSessionId: 'parent-1' },
      }],
    })

    const listed = await managedAgentsBridge(
      { store } as unknown as ManagedAgentRuntime,
      { projectSessionList },
    ).listSessions({ taskId: session.taskId })
    expect(listed.delegations).toEqual([{
      sessionId: session.id,
      depth: 1,
      isolation: 'shared',
      owner: { kind: 'managed', parentSessionId: 'parent-1' },
    }])
  })
})
