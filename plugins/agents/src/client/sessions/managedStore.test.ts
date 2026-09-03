// The transcript store's per-event bookkeeping.
//
// A streaming session reaches a client about 25 times a second (the node coalesces text deltas at
// 40 ms in ../../server/sessions/durableEventBuffer.ts), and a long session on this machine's database
// holds 2,700 events. So everything here is about what one frame costs: it used to be two linear
// scans, a copy of the whole array and a sort of an already-sorted array, plus a refetch of up to
// 2,000 rows whenever a projected event arrived.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentRequest,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'

let onFrame: ((value: unknown) => void) | undefined
vi.mock('./wsChannel', () => ({
  wsOnAgentFrame: (cb: (value: unknown) => void) => {
    onFrame = cb
    return () => { onFrame = undefined }
  },
}))

const snapshotCalls: string[] = []
const sessionCalls: { taskId?: string }[] = []
let failSessions = false
let served: AgentSessionSnapshot
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    snapshot: async (sessionId: string) => {
      snapshotCalls.push(sessionId)
      return served
    },
    sessions: async (query: { taskId?: string } = {}) => {
      sessionCalls.push(query)
      if (failSessions) throw new Error('offline')
      return { sessions: [], nextCursor: null }
    },
  },
}))

const { managedAgentStore } = await import('./managedStore')

const SESSION = 's1'
const session = {
  id: SESSION,
  taskId: 't1',
  title: 'A session',
  config: {},
  createdAt: 1,
  updatedAt: 1,
  lastEventSeq: 0,
  lastReadSeq: 0,
  attention: 'none',
  controller: 'acorn',
  runtimeState: 'ready',
  subagents: [],
} as unknown as AgentSession

const event = (seq: number, event: AgentNormalizedEvent, turnId: string | null = 'turn1'): AgentEventRecord => ({
  id: `e${seq}`,
  sessionId: SESSION,
  turnId,
  seq,
  schemaVersion: 1,
  event,
  searchText: null,
  createdAt: seq,
})
const prose = (seq: number) => event(seq, { type: 'assistant_message', text: `d${seq}`, messageId: 'm1' })
const usage = (seq: number, fields: Record<string, unknown>, turnId: string | null = 'turn1') =>
  event(seq, { type: 'usage', usage: fields }, turnId)

const push = (value: unknown) => onFrame?.(value)
const events = () => managedAgentStore.snapshots()[SESSION].events

const seed = async (snapshot: Partial<AgentSessionSnapshot> = {}) => {
  served = { session, turns: [], events: [], requests: [], ...snapshot }
  managedAgentStore.activate()
  await managedAgentStore.loadSnapshot(SESSION)
  snapshotCalls.length = 0
}

beforeEach(() => {
  managedAgentStore.clear()
  snapshotCalls.length = 0
})

describe('appending a streamed event', () => {
  it('never sorts, and stays in seq order over two thousand of them', async () => {
    await seed()
    const sort = vi.spyOn(Array.prototype, 'sort')
    for (let seq = 1; seq <= 2_000; seq++) push({ channel: 'agent:event', event: prose(seq) })
    // The old path copied the array and sorted it once per frame. Two thousand frames is two thousand
    // sorts of an array that was already ordered.
    expect(sort).not.toHaveBeenCalled()
    sort.mockRestore()

    expect(events()).toHaveLength(2_000)
    expect(events().map((item) => item.seq).every((seq, at) => seq === at + 1)).toBe(true)
  })

  it('seats an out-of-order event in position', async () => {
    await seed()
    for (const seq of [1, 2, 5, 6]) push({ channel: 'agent:event', event: prose(seq) })
    // What a reconnect replay can deliver: a frame the client already moved past.
    push({ channel: 'agent:event', event: prose(3) })
    expect(events().map((item) => item.seq)).toEqual([1, 2, 3, 5, 6])
  })

  it('drops a redelivered id', async () => {
    await seed()
    push({ channel: 'agent:event', event: prose(1) })
    push({ channel: 'agent:event', event: prose(1) })
    push({ channel: 'agent:event', event: prose(2) })
    expect(events().map((item) => item.id)).toEqual(['e1', 'e2'])
  })

  it('keeps the array in step with the seen set after a splice', async () => {
    await seed()
    for (const seq of [1, 4]) push({ channel: 'agent:event', event: prose(seq) })
    push({ channel: 'agent:event', event: prose(2) })
    push({ channel: 'agent:event', event: prose(2) })
    expect(events().map((item) => item.seq)).toEqual([1, 2, 4])
  })
})

describe('a turn’s usage updates', () => {
  it('become one line, merged, at the first update’s place', async () => {
    await seed()
    push({ channel: 'agent:event', event: prose(1) })
    for (let at = 1; at <= 58; at++) {
      push({ channel: 'agent:event', event: usage(at + 1, { contextUsed: at * 100, inputTokens: at }) })
    }
    expect(events()).toHaveLength(2)
    expect(events()[1].id).toBe('e2')
    expect(events()[1].event).toEqual({ type: 'usage', usage: { contextUsed: 5_800, inputTokens: 58 } })
  })

  it('starts a new line for the next turn, and takes a trailing turn-less update', async () => {
    await seed()
    push({ channel: 'agent:event', event: usage(1, { contextUsed: 100 }) })
    push({ channel: 'agent:event', event: usage(2, { contextUsed: 200 }, 'turn2') })
    // A turn's last usage update can arrive after the turn is marked complete, so it carries no turn
    // id and belongs to the line it is updating.
    push({ channel: 'agent:event', event: usage(3, { cost: { amount: 0.5, currency: 'USD' } }, null) })
    expect(events()).toHaveLength(2)
    expect(events()[1].event).toEqual({
      type: 'usage',
      usage: { contextUsed: 200, cost: { amount: 0.5, currency: 'USD' } },
    })
  })
})

describe('what a projected event costs', () => {
  const turn = (status: AgentTurn['status']): AgentTurn => ({
    id: 'turn1',
    sessionId: SESSION,
    ordinal: 0,
    source: 'interactive',
    status,
    input: [],
    effectivePolicy: {},
    providerTurnRef: null,
    stopReason: null,
    usage: null,
    error: null,
    attempt: 0,
    createdAt: 1,
    startedAt: null,
    completedAt: null,
  })
  const request = (status: AgentRequest['status']): AgentRequest => ({
    id: 'r1',
    sessionId: SESSION,
    turnId: 'turn1',
    providerRequestId: 'p1',
    kind: 'permission',
    status,
    title: 'May I',
    detail: null,
    payload: {},
    resolution: null,
    expiresAt: null,
    createdAt: 1,
    resolvedAt: null,
  })

  it('reads no rows for a completed turn: the node sends the turn', async () => {
    await seed({ turns: [turn('active')] })
    push({ channel: 'agent:event', event: event(1, { type: 'turn_completed' }) })
    push({ channel: 'agent:turn', turn: { ...turn('completed'), stopReason: 'end_turn' } })
    await vi.waitFor(() => expect(managedAgentStore.snapshots()[SESSION].turns[0].status).toBe('completed'))
    expect(managedAgentStore.snapshots()[SESSION].turns[0].stopReason).toBe('end_turn')
    expect(snapshotCalls).toEqual([])
  })

  it('reads no rows for a request or its answer: the node sends the request', async () => {
    await seed()
    push({ channel: 'agent:event', event: event(1, { type: 'request', requestId: 'p1', kind: 'permission', title: 'May I' }) })
    push({ channel: 'agent:request', request: request('pending') })
    expect(managedAgentStore.snapshots()[SESSION].requests.map((item) => item.status)).toEqual(['pending'])

    push({ channel: 'agent:event', event: event(2, { type: 'request_resolved', requestId: 'p1', resolution: 'allow' }) })
    push({ channel: 'agent:request', request: { ...request('resolved'), resolvedAt: 2 } })
    expect(managedAgentStore.snapshots()[SESSION].requests.map((item) => item.status)).toEqual(['resolved'])
    expect(snapshotCalls).toEqual([])
  })

  it('still refetches on an error, because it also expires this session’s pending requests', async () => {
    await seed({ requests: [request('pending')] })
    served = { session, turns: [], events: [], requests: [request('expired')] }
    push({ channel: 'agent:event', event: event(1, { type: 'error', code: 'boom', message: 'boom', retryable: false }) })
    await vi.waitFor(() => expect(snapshotCalls).toEqual([SESSION]))
  })
})

// The rail warms a task's session list on hover, and the pane model asks for the same list a moment
// later when the reader clicks (docs/panes.md § Contributions). Without a window between them that is
// two reads of the same rows for one click.
describe('a task’s session list', () => {
  beforeEach(() => {
    sessionCalls.length = 0
    managedAgentStore.clear()
  })

  it('is read once for a hover and the click that follows it', async () => {
    await Promise.all([managedAgentStore.loadTask('t9'), managedAgentStore.loadTask('t9')])
    await managedAgentStore.loadTask('t9')
    expect(sessionCalls).toEqual([{ taskId: 't9', archived: false }])
  })

  it('is read again for another task, and again once the window has passed', async () => {
    await managedAgentStore.loadTask('t9')
    await managedAgentStore.loadTask('t10')
    expect(sessionCalls).toHaveLength(2)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 6_000)
      await managedAgentStore.loadTask('t9')
    } finally {
      vi.useRealTimers()
    }
    expect(sessionCalls).toHaveLength(3)
  })

  it('never remembers a failure', async () => {
    failSessions = true
    await expect(managedAgentStore.loadTask('t11')).rejects.toThrow('offline')
    failSessions = false
    await managedAgentStore.loadTask('t11')
    // Two reads for two asks: a window that held on to the rejection would leave the pane empty with
    // nothing to retry.
    expect(sessionCalls).toHaveLength(2)
  })
})
