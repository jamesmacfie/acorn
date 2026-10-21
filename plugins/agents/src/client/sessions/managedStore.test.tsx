// Priming the managed-session roster: when the store asks a node for it, and when it does not.
//
// A `.tsx` rather than a case in `./managedStore.test.ts`, because this is the one thing in the store
// that is reactive. The `logic` project runs `.test.ts` in bare Node with no `browser` condition, so
// solid-js resolves to its server build and every effect there is dead on arrival; the `hosts`
// project runs `.tsx` under jsdom with the browser build (plugins/vitest.shared.ts). `toolFoldPrefs`
// splits its tests the same way.
import { describe, expect, it, vi } from 'vitest'
import { batch, createEffect, createMemo, createRoot, createSignal } from 'solid-js'
import type { AgentEventRecord, AgentSession } from '../../contract/wire.ts'

let onFrame: ((value: unknown) => void) | undefined
vi.mock('./wsChannel', () => ({
  wsOnAgentFrame: (cb: (value: unknown) => void) => {
    onFrame = cb
    return () => {}
  },
}))

const sessionCalls: { archived?: boolean }[] = []
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    snapshot: async (sessionId: string) => ({
      session: rosterRow(sessionId, 1),
      turns: [],
      events: [],
      requests: [],
    }),
    events: async () => ({ events: [], nextCursor: null }),
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
  // `activateManagedAgentNotifications` opens an app-lifetime root that only the plugin host's
  // disposal releases, so a second activation here would leave the first one still priming in the
  // background and every count off by one.
  it('waits for a node that can answer, primes once, and follows a switch', async () => {
    setTestNodeId('node-a')
    setTestNodeState('offline')
    activateManagedAgentNotifications()
    await settle()
    // `acorn` draws its shell in front of a node it just started
    // (docs/tui/process.md § Attach or start), so a prime at activation could only come back
    // ECONNREFUSED, with a stack printed onto a terminal the renderer owns.
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
    // and nothing else refills it until somebody opens Agent Center.
    setTestNodeId('node-b')
    await settle()
    expect(sessionCalls).toHaveLength(2)
  })
})

const rosterRow = (id: string, updatedAt: number): AgentSession =>
  ({
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
  }) as unknown as AgentSession

describe('a page of sessions', () => {
  it('publishes the whole page once, not once per row', async () => {
    const lengths: number[] = []
    createRoot(() => createEffect(() => lengths.push(managedAgentStore.sessions().length)))
    await settle()

    managedAgentStore.upsertSessions([rosterRow('s1', 3), rosterRow('s2', 2), rosterRow('s3', 1)])
    await settle()

    // The number that matters is how many times the roster published, not what it holds. Agent Center
    // rebuilds and re-sorts its list on every publish, so a page walked row by row would cost one
    // rebuild per session in the workspace.
    expect(lengths).toEqual([0, 3])
    expect(managedAgentStore.sessions().map((session) => session.id)).toEqual(['s1', 's2', 's3'])
  })
})

describe('a session’s transcript', () => {
  const frame = (sessionId: string, seq: number) => ({
    channel: 'agent:event',
    event: {
      id: `${sessionId}-${seq}`,
      sessionId,
      turnId: 'turn1',
      seq,
      schemaVersion: 1,
      event: { type: 'assistant_message', text: `line ${seq}`, messageId: 'm1' },
      searchText: null,
      createdAt: seq,
    } satisfies AgentEventRecord,
  })

  it('wakes only the readers of the session whose event arrived', async () => {
    managedAgentStore.activate()
    await Promise.all([managedAgentStore.loadSnapshot('a'), managedAgentStore.loadSnapshot('b')])
    const reads: string[] = []
    createRoot(() => {
      createMemo(() => reads.push(`a:${managedAgentStore.snapshotFor('a')?.events.length}`))
      createMemo(() => reads.push(`b:${managedAgentStore.snapshotFor('b')?.events.length}`))
    })
    reads.length = 0

    onFrame?.(frame('a', 1))
    expect(reads).toEqual(['a:1'])
    onFrame?.(frame('b', 1))
    expect(reads).toEqual(['a:1', 'b:1'])
  })

  it('updates its readers once for frames applied together', async () => {
    managedAgentStore.activate()
    await managedAgentStore.loadSnapshot('a')
    const reads: number[] = []
    createRoot(() => createMemo(() => reads.push(managedAgentStore.snapshotFor('a')?.events.length ?? 0)))
    const before = reads.pop()!
    reads.length = 0

    // The socket client's drain applies a queued run of frames inside one batch.
    batch(() => {
      for (let seq = 10; seq < 20; seq++) onFrame?.(frame('a', seq))
    })

    expect(reads).toEqual([before + 10])
  })
})
