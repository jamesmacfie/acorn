// The transcript store's per-event bookkeeping.
//
// A streaming session reaches a client about 25 times a second (the node coalesces text deltas at
// 40 ms in ../../server/sessions/durableEventBuffer.ts), and a long session on this machine's database
// holds 2,700 events. So everything here is about what one frame costs: it used to be two linear
// scans, a copy of the whole array and a sort of an already-sorted array, plus a refetch of up to
// 2,000 rows whenever a projected event arrived.
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentRequest,
  AgentSession,
  AgentSessionList,
  AgentSessionSnapshot,
  AgentTurn,
} from '../../contract/wire.ts'

let onFrame: ((value: unknown) => void) | undefined
vi.mock('./wsChannel', () => ({
  wsOnAgentFrame: (cb: (value: unknown) => void) => {
    onFrame = cb
    return () => { onFrame = undefined }
  },
}))

const snapshotCalls: string[] = []
const snapshotCursors: number[] = []
const pageCalls: number[] = []
const sessionCalls: { taskId?: string }[] = []
let failSessions = false
let served: AgentSessionSnapshot
// Per-session answers, for the tests that hold more than one session, and reads held open until let go.
let servedBy: Record<string, AgentSessionSnapshot> = {}
let gates: Record<string, Promise<void>> = {}
// The rest of the ledger, keyed by the cursor the client pages from.
let servedPages: Record<number, AgentEventRecord[]> = {}
let servedList: AgentSessionList = { sessions: [], delegations: [], nextCursor: null }
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    // The route's own rule: every turn and request, and the events after the cursor.
    snapshot: async (sessionId: string, afterSeq = 0) => {
      snapshotCalls.push(sessionId)
      snapshotCursors.push(afterSeq)
      await gates[sessionId]
      const base = servedBy[sessionId] ?? served
      return { ...base, events: base.events.filter((item) => item.seq > afterSeq) }
    },
    events: async (_sessionId: string, afterSeq: number) => {
      pageCalls.push(afterSeq)
      return { events: servedPages[afterSeq] ?? [], nextCursor: null }
    },
    sessions: async (query: { taskId?: string } = {}) => {
      sessionCalls.push(query)
      if (failSessions) throw new Error('offline')
      return servedList
    },
  },
}))

const { managedAgentStore } = await import('./managedStore')
const { buildConversationItems, createConversationProjection } = await import('./conversationItems')
const { foldToolEvents } = await import('../../shared/toolFold')
const { foldUsageEvents } = await import('../../shared/usageFold')

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
  snapshotCursors.length = 0
}

beforeEach(() => {
  managedAgentStore.clear()
  snapshotCalls.length = 0
  snapshotCursors.length = 0
  pageCalls.length = 0
  servedPages = {}
  servedList = { sessions: [], delegations: [], nextCursor: null }
  servedBy = {}
  gates = {}
})

// The snapshot route caps its event list, so a session past the cap arrives short. Reopening one used
// to stop at the cap and show a transcript that ended hours before the last message.
describe('a snapshot the node truncated', () => {
  it('pages forward until it reaches lastEventSeq', async () => {
    servedPages = { 2: [prose(3), prose(4)], 4: [prose(5)] }
    await seed({ session: { ...session, lastEventSeq: 5 }, events: [prose(1), prose(2)] })
    expect(pageCalls).toEqual([2, 4])
    expect(events().map((item) => item.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('asks for nothing when the snapshot already holds the whole ledger', async () => {
    await seed({ session: { ...session, lastEventSeq: 2 }, events: [prose(1), prose(2)] })
    expect(pageCalls).toEqual([])
  })

  it('stops on an empty page rather than looping', async () => {
    await seed({ session: { ...session, lastEventSeq: 9 }, events: [prose(1)] })
    expect(pageCalls).toEqual([1])
    expect(events().map((item) => item.seq)).toEqual([1])
  })
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
// later when the reader clicks (docs/panes/contributions.md § Contributions). Without a window between them that is
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

  it('keeps list-projected delegation metadata separate from live session updates', async () => {
    const child = { ...session, id: 'delegated-1', taskId: 't12', kind: 'delegated' as const }
    servedList = {
      sessions: [child],
      delegations: [{
        sessionId: child.id,
        depth: 1,
        isolation: 'shared' as const,
        owner: { kind: 'terminal' as const, label: 'Codex terminal', profileId: 'codex' },
      }],
      nextCursor: null,
    }
    await managedAgentStore.loadTask('t12')
    managedAgentStore.upsertSession({ ...child, runtimeState: 'working', updatedAt: 2 })

    expect(managedAgentStore.delegations()[child.id]).toMatchObject({
      depth: 1,
      owner: { kind: 'terminal', label: 'Codex terminal' },
    })
    expect(managedAgentStore.sessions().find((item) => item.id === child.id)?.runtimeState).toBe('working')
  })

  it('loads bounded lineage when a delegated session first arrives over the socket', async () => {
    const child = { ...session, id: 'delegated-live', taskId: 't13', kind: 'delegated' as const }
    servedList = {
      sessions: [child],
      delegations: [{
        sessionId: child.id,
        depth: 1,
        isolation: 'shared',
        owner: { kind: 'managed', parentSessionId: 'parent-live' },
      }],
      nextCursor: null,
    }
    const release = managedAgentStore.activate()
    push({ channel: 'agent:session', session: child })
    await vi.waitFor(() => expect(managedAgentStore.delegations()[child.id]).toBeDefined())
    expect(sessionCalls).toEqual([{ taskId: child.taskId, archived: false }])
    release()
  })
})

describe('a session’s snapshot', () => {
  it('is one read for two readers in the same tick', async () => {
    served = { session, turns: [], events: [], requests: [] }
    await Promise.all([managedAgentStore.loadSnapshot(SESSION), managedAgentStore.loadSnapshot(SESSION)])
    // Two panes open on one session, which is what the run pane makes possible. The transcript is up
    // to a couple of thousand event rows, so the second reader has to be free.
    expect(snapshotCalls).toEqual([SESSION])
  })

  it('is read again once the first has settled', async () => {
    served = { session, turns: [], events: [], requests: [] }
    await managedAgentStore.loadSnapshot(SESSION)
    await managedAgentStore.loadSnapshot(SESSION)
    // Not a time window: every caller after a send asks because it expects the answer to have
    // changed, and holding the old one would show the transcript from before the turn.
    expect(snapshotCalls).toEqual([SESSION, SESSION])
  })
})

// Switching back to a task used to read its whole session again: 2.9 MB for a 4,000-event transcript
// the store already held, 11.7 MB for a 16,000-event one. The ledger only appends, so a held session
// reads on from where its events are whole.
describe('reading a session the store holds', () => {
  const pending = {
    id: 'r1', sessionId: SESSION, turnId: 'turn1', providerRequestId: 'p1', kind: 'permission',
    status: 'pending', title: 'May I', detail: null, payload: {}, resolution: null, expiresAt: null,
    createdAt: 1, resolvedAt: null,
  } as AgentRequest

  it('resumes after the last event the socket delivered, and keeps the held events as they are', async () => {
    await seed({ session: { ...session, lastEventSeq: 3 }, events: [prose(1), prose(2), prose(3)] })
    for (const seq of [4, 5]) push({ channel: 'agent:event', event: prose(seq) })
    const held = events()
    pageCalls.length = 0
    served = { ...served, session: { ...session, lastEventSeq: 5 }, events: [1, 2, 3, 4, 5].map(prose) }
    await managedAgentStore.loadSnapshot(SESSION)
    expect(snapshotCursors).toEqual([5])
    expect(pageCalls).toEqual([])
    expect(events()).toBe(held)
    expect(events().map((item) => item.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('resumes at a gap the socket left, not after the frames that followed it', async () => {
    await seed({ session: { ...session, lastEventSeq: 2 }, events: [prose(1), prose(2)] })
    // Seq 4 is lost. A later frame must not move the mark past it, or the read would skip it for good.
    for (const seq of [3, 5]) push({ channel: 'agent:event', event: prose(seq) })
    served = { ...served, session: { ...session, lastEventSeq: 5 }, events: [1, 2, 3, 4, 5].map(prose) }
    await managedAgentStore.loadSnapshot(SESSION)
    expect(snapshotCursors).toEqual([3])
    expect(events().map((item) => item.seq)).toEqual([1, 2, 3, 4, 5])

    // Whole again, so the next read resumes at the end.
    await managedAgentStore.loadSnapshot(SESSION)
    expect(snapshotCursors).toEqual([3, 5])
  })

  it('pages on from a folded row’s reach', async () => {
    servedPages = { 9: [prose(10)] }
    await seed({
      session: { ...session, lastEventSeq: 10 },
      events: [{ ...event(1, { type: 'tool', tool: { id: 'x', title: 'Run', status: 'completed' } }), foldedThroughSeq: 9 }],
    })
    expect(pageCalls).toEqual([9])
    await managedAgentStore.loadSnapshot(SESSION)
    expect(snapshotCursors).toEqual([10])
  })

  it('still brings the turns and requests back whole', async () => {
    await seed({ session: { ...session, lastEventSeq: 1 }, events: [prose(1)], requests: [pending] })
    // A stop expires pending requests, and no frame says so.
    served = { ...served, requests: [{ ...pending, status: 'expired' }] }
    await managedAgentStore.loadSnapshot(SESSION)
    expect(snapshotCursors).toEqual([1])
    expect(managedAgentStore.snapshots()[SESSION].requests.map((item) => item.status)).toEqual(['expired'])
  })

  it('reads from the start once the store has dropped it', async () => {
    await seed({ session: { ...session, lastEventSeq: 2 }, events: [prose(1), prose(2)] })
    managedAgentStore.clear()
    await managedAgentStore.loadSnapshot(SESSION)
    expect(snapshotCursors).toEqual([0])
    expect(events().map((item) => item.seq)).toEqual([1, 2])
  })
})

// The store kept every transcript it read until the session was deleted: 46 MB of JSON after opening
// eight real sessions one after another. It keeps what is drawn and the three drawn last.
describe('which snapshots the store keeps', () => {
  const answer = (id: string): AgentSessionSnapshot => ({
    session: { ...session, id, lastEventSeq: 1 },
    turns: [],
    requests: [],
    events: [{ ...prose(1), id: `${id}-e1`, sessionId: id }],
  })
  // What the conversation does when it mounts: hold, then read.
  const open = async (id: string) => {
    servedBy[id] ??= answer(id)
    const release = managedAgentStore.hold(id)
    await managedAgentStore.loadSnapshot(id)
    return release
  }
  const visit = async (...ids: string[]) => {
    for (const id of ids) (await open(id))()
  }
  const kept = () => Object.keys(managedAgentStore.snapshots()).sort()

  it('keeps the three drawn last and drops the rest, rows and all left in the roster', async () => {
    await visit('a', 'b', 'c', 'd', 'e')
    expect(kept()).toEqual(['c', 'd', 'e'])
    expect(managedAgentStore.sessions().map((item) => item.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('never drops a session something is drawing, and counts letting go as the latest drawing', async () => {
    const releaseA = await open('a')
    await visit('b', 'c', 'd', 'e')
    expect(kept()).toEqual(['a', 'c', 'd', 'e'])
    releaseA()
    expect(kept()).toEqual(['a', 'd', 'e'])
  })

  it('holds a session for as long as any of its readers does', async () => {
    // The Agent pane and the Workflows run pane can draw one session at once.
    const first = await open('a')
    const second = managedAgentStore.hold('a')
    first()
    first()
    await visit('b', 'c', 'd', 'e')
    expect(kept()).toContain('a')
    second()
    expect(kept()).toEqual(['a', 'd', 'e'])
  })

  it('reads a dropped session from the start, and leaves its frames alone until then', async () => {
    await visit('a', 'b', 'c', 'd')
    expect(kept()).not.toContain('a')
    push({ channel: 'agent:event', event: { ...prose(2), id: 'a-e2', sessionId: 'a' } })
    expect(kept()).not.toContain('a')

    snapshotCursors.length = 0
    const release = await open('a')
    expect(snapshotCursors).toEqual([0])
    release()
  })

  it('leaves a session alone while it is being read', async () => {
    await visit('a', 'b', 'c')
    let open_ = (): void => undefined
    gates.a = new Promise((resolve) => { open_ = resolve })
    const reading = managedAgentStore.loadSnapshot('a')
    await visit('d', 'e')
    // Past the bound, and the oldest, but its read resumes from the events it holds.
    expect(kept()).toContain('a')
    open_()
    await reading
    expect(snapshotCursors.at(-3)).toBe(1)
    expect(kept()).toEqual(['a', 'd', 'e'])
  })

  it('does not read back a session it is not keeping when that session reports an error', async () => {
    managedAgentStore.upsertSession({ ...session, id: 'z' })
    push({ channel: 'agent:event', event: { ...event(1, { type: 'error', code: 'boom', message: 'boom', retryable: false }), id: 'z-e1', sessionId: 'z' } })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(snapshotCalls).not.toContain('z')
  })
})

// The transcript keeps its projection open and adds each streamed row to it rather than rebuilding
// the whole session per event (conversationItems.ts § createConversationProjection). That is only
// right if it always lands where a rebuild would, whatever the store did to the array: pushed a row,
// merged a usage update into the line in place, seated a late frame behind the tail, or took a row the
// node's fold already covered. So these drive the real store, a frame at a time, and compare the kept
// projection with a fresh one after every frame.
describe('the transcript projection a streaming session keeps', () => {
  // mulberry32: a seeded stream, so a failure replays.
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  // Shaped like a harness's stream: turns of text deltas, tool calls whose updates stream as appends
  // and end on a whole output, subagents with their own runs, per-turn usage with a trailing turn-less
  // update, plans, and closing lines that sometimes carry no turn.
  const synthetic = (count: number, random: () => number): AgentEventRecord[] => {
    const out: AgentEventRecord[] = []
    const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]
    const calls: { id: string; turnId: string | null; subagentId?: string }[] = []
    const subagents: string[] = []
    let turnId: string | null = null
    let turns = 0
    let message = 'm0'
    const emit = (value: AgentNormalizedEvent, turn: string | null = turnId) => out.push(event(out.length + 1, value, turn))
    while (out.length < count) {
      const roll = random()
      if (!turnId || roll < 0.03) {
        if (turnId) {
          emit({ type: 'turn_completed', stopReason: 'end_turn' }, random() < 0.5 ? null : turnId)
          if (random() < 0.5) emit({ type: 'usage', usage: { cost: { amount: out.length, currency: 'USD' } } }, null)
        }
        turnId = `turn${++turns}`
        emit({ type: 'user_message', text: 'go' })
      } else if (roll < 0.25) {
        if (random() < 0.1) message = `m${out.length}`
        emit({ type: random() < 0.2 ? 'reasoning' : 'assistant_message', text: 'x', messageId: message, append: random() < 0.8,
          ...(subagents.length && random() < 0.2 ? { subagentId: pick(subagents) } : {}) })
      } else if (roll < 0.35) {
        const call = { id: `call${out.length}`, turnId: random() < 0.1 ? null : turnId,
          ...(subagents.length && random() < 0.3 ? { subagentId: pick(subagents) } : {}) }
        calls.push(call)
        emit({ type: 'tool', tool: { id: call.id, title: 'Run', kind: 'execute', status: 'running', subagentId: call.subagentId } }, call.turnId)
      } else if (roll < 0.62 && calls.length) {
        const call = pick(calls.slice(-6))
        const shape = random()
        emit({ type: 'tool', tool: shape < 0.6
          ? { id: call.id, title: '', output: `o${out.length}\n`, outputAppend: true }
          : shape < 0.8
            ? { id: call.id, title: '', status: 'completed', output: 'whole\n' }
            : { id: call.id, title: '', subagentId: random() < 0.5 ? call.subagentId : undefined } }, call.turnId)
      } else if (roll < 0.74) {
        emit({ type: 'usage', usage: { contextUsed: out.length * 10, ...(random() < 0.3 ? { contextSize: 200_000 } : {}), inputTokens: out.length } },
          random() < 0.2 ? null : turnId)
      } else if (roll < 0.8) {
        const id = subagents.length && random() < 0.6 ? pick(subagents) : `sub${out.length}`
        if (!subagents.includes(id)) subagents.push(id)
        emit({ type: 'subagent', subagent: { id, title: random() < 0.5 ? 'Explore' : undefined, status: pick(['running', 'completed'] as const) } })
      } else if (roll < 0.85) {
        emit({ type: 'plan', entries: [{ id: 'p', text: `step ${out.length}`, status: 'in_progress' }] })
      } else if (roll < 0.9) {
        emit({ type: 'file_change', path: 'a.ts', ...(subagents.length && random() < 0.3 ? { subagentId: pick(subagents) } : {}) })
      } else if (roll < 0.95) {
        emit(random() < 0.5 ? { type: 'session_state', state: 'working' } : { type: 'diagnostic', level: 'info', message: 'note' })
      } else {
        emit({ type: 'user_message', text: 'brief', ...(subagents.length ? { subagentId: pick(subagents) } : {}) })
      }
    }
    return out
  }

  // Load the first `loaded` rows the way the node serves them, folded a page at a time, then stream the
  // rest. Now and then a frame arrives late, and now and then one the load already covered comes again.
  // Returns how many frames it compared after.
  const replay = async (
    all: AgentEventRecord[],
    { loaded, page, random, compare }: {
      loaded: number
      page: number
      random: () => number
      compare: (kept: unknown, fresh: unknown) => void
    },
  ): Promise<number> => {
    const head = all.slice(0, loaded)
    const pages: AgentEventRecord[][] = []
    for (let at = 0; at < head.length; at += page) pages.push(foldToolEvents(foldUsageEvents(head.slice(at, at + page))))
    servedPages = Object.fromEntries(pages.slice(1).map((events, at) => [pages[at].reduce((reach, record) =>
      Math.max(reach, record.foldedThroughSeq ?? record.seq), 0), events]))
    await seed({ session: { ...session, lastEventSeq: head.at(-1)?.seq ?? 0 }, events: pages[0] ?? [] })
    const project = createConversationProjection()
    project(events())

    // The socket's copy of the load's last rows first: frames that landed while the read was out. The
    // node folded the tail ones into earlier cards, so they seat after the array's last record and
    // are already inside a card's reach (`foldedThroughSeq`).
    const frames = [...head.slice(-8), ...all.slice(loaded)]
    for (let at = 0; at + 1 < frames.length; at++) {
      if (random() < 0.01) [frames[at], frames[at + 1]] = [frames[at + 1], frames[at]]
    }
    let steps = 0
    for (const [at, record] of frames.entries()) {
      if (head.length && random() < 0.02) frames.splice(at + 1, 0, head[Math.floor(random() * head.length)])
      push({ channel: 'agent:event', event: record })
      compare(project(events()), buildConversationItems(events()))
      steps++
    }
    return steps
  }

  // The fast comparison first, and vitest's only for the diff when they differ: a few thousand
  // frames each comparing a few hundred cards.
  const exact = (kept: unknown, fresh: unknown) => {
    if (!isDeepStrictEqual(kept, fresh)) expect(kept).toEqual(fresh)
  }

  it('matches a rebuild after every frame of a seeded stream', async () => {
    for (const seed_ of [1, 2, 3, 4, 5]) {
      const random = seeded(seed_)
      const all = synthetic(1_500, random)
      // Cut the load after a run of tool updates, so the node folds its last rows into earlier cards.
      const update = (record: AgentEventRecord | undefined) => record?.event.type === 'tool' && record.event.tool.title === ''
      const loaded = all.findIndex((_, at) => at >= 600 && update(all[at - 1]) && update(all[at - 2]) && update(all[at - 3]))
      managedAgentStore.clear()
      expect(await replay(all, { loaded, page: 170, random, compare: exact })).toBeGreaterThan(500)
    }
  })

  it('matches a rebuild when every row streams, from an empty transcript', async () => {
    const random = seeded(9)
    await replay(synthetic(1_200, random), { loaded: 0, page: 1, random, compare: exact })
  })

  // A real session, when there is one to hand: a JSON array of event records, as the ledger holds them.
  // `ACORN_TRANSCRIPT_REPLAY=/path/to/events.json`, ordered by seq. The last quarter streams.
  const recorded = process.env.ACORN_TRANSCRIPT_REPLAY
  it.skipIf(!recorded)('matches a rebuild after every frame of a recorded session', async () => {
    const all = (JSON.parse(readFileSync(recorded!, 'utf8')) as AgentEventRecord[])
      .map((record) => ({ ...record, sessionId: SESSION }))
    const loaded = Math.floor(all.length * 0.75)
    const steps = await replay(all, { loaded, page: 2_000, random: seeded(7), compare: exact })
    expect(steps).toBeGreaterThanOrEqual(all.length - loaded)
  }, 3_600_000)
})
