// Priming the managed-session roster: when the store asks a node for it, and when it does not.
//
// A `.tsx` rather than a case in `./managedStore.test.ts`, because this is the one thing in the store
// that is reactive. The `logic` project runs `.test.ts` in bare Node with no `browser` condition, so
// solid-js resolves to its server build and every effect there is dead on arrival; the `hosts`
// project runs `.tsx` under jsdom with the browser build (plugins/vitest.shared.ts). Same split
// `toolFoldPrefs` already uses, and the reason its two files sit beside each other.
import { describe, expect, it, vi } from 'vitest'
import { createEffect, createRoot, createSignal } from 'solid-js'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'

vi.mock('./wsChannel', () => ({ wsOnAgentFrame: () => () => {} }))

const sessionCalls: { archived?: boolean }[] = []
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    sessions: async (query: { archived?: boolean } = {}) => {
      sessionCalls.push(query)
      return { sessions: [], delegations: [], nextCursor: null }
    },
  },
}))

// The fleet, as the prime effect reads it. Signals rather than constants, because the whole point of
// the effect is that it reacts: nothing is asked of a node that cannot answer, and the prime goes out
// the moment one can.
const [testNodeId, setTestNodeId] = createSignal<string | null>(null)
const [testNodeState, setTestNodeState] = createSignal<'offline' | 'online'>('offline')
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  activeNodeId: () => testNodeId(),
  nodeState: () => testNodeState(),
}))

const { activateManagedAgentNotifications, managedAgentStore } = await import('./managedStore')

// Solid queues effects, so a signal write reaches the store one macrotask later.
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

describe('priming the managed-session roster', () => {
  // One test rather than three, because there is one effect and it outlives the case that made it.
  // `activateManagedAgentNotifications` opens a root it never releases, which is right for an
  // app-lifetime subscription and means a second activation here would leave the first one still
  // priming in the background and every count off by one.
  it('waits for a node that can answer, primes once, and follows a switch', async () => {
    setTestNodeId('node-a')
    setTestNodeState('offline')
    activateManagedAgentNotifications()
    await settle()
    // The regression this exists for: `acorn` draws its shell in front of a node it just started
    // (docs/tui.md § Attach or start), so a prime at activation was a request that could only come
    // back ECONNREFUSED, with a stack printed onto a terminal the renderer owns.
    expect(sessionCalls).toHaveLength(0)

    setTestNodeState('online')
    await settle()
    expect(sessionCalls).toHaveLength(1)

    // Not a subscription to every status change. A node that drops and comes back has a roster the
    // socket kept current, so re-reading the whole thing would be work for nothing.
    setTestNodeState('offline')
    await settle()
    setTestNodeState('online')
    await settle()
    expect(sessionCalls).toHaveLength(1)

    // A switch is the one thing that does re-prime. `onScopeEvicted` clears the store on that switch,
    // and nothing refilled it until somebody opened Agent Center.
    setTestNodeId('node-b')
    await settle()
    expect(sessionCalls).toHaveLength(2)
  })
})

const rosterRow = (id: string, updatedAt: number): AgentSession => ({
  id,
  taskId: 't1',
  title: id,
  config: {},
  createdAt: 1,
  updatedAt,
  lastEventSeq: 0,
  lastReadSeq: 0,
  attention: 'none',
  controller: 'acorn',
  runtimeState: 'ready',
  subagents: [],
} as unknown as AgentSession)

describe('a page of sessions', () => {
  it('publishes the whole page once, not once per row', async () => {
    const lengths: number[] = []
    createRoot(() => createEffect(() => lengths.push(managedAgentStore.sessions().length)))
    await settle()

    managedAgentStore.upsertSessions([rosterRow('s1', 3), rosterRow('s2', 2), rosterRow('s3', 1)])
    await settle()

    // The number that matters is how many times the roster published, not what it holds. Agent Center
    // rebuilds and re-sorts its list on every publish, so a page walked row by row cost one rebuild
    // per session in the workspace.
    expect(lengths).toEqual([0, 3])
    expect(managedAgentStore.sessions().map((session) => session.id)).toEqual(['s1', 's2', 's3'])
  })
})
