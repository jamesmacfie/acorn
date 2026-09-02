import { createSignal } from 'solid-js'
import { activeNodeId, fromManagedSession, observeAttention, onScopeEvicted } from '@acorn/plugin-api/client'
import { wsOnAgentFrame } from './wsChannel'
import type {
  AgentEventRecord,
  AgentRequest,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
  AgentWsFrame,
} from '@acorn/protocol/managedAgents.ts'
import { managedAgentApi } from './managedClient'
import { mergeManagedSnapshot, newestManagedSession } from './managedSnapshot'
import { mergeAgentUsage, openUsageLine } from '../../shared/usageFold'

const [sessions, setSessions] = createSignal<AgentSession[]>([])
const [snapshots, setSnapshots] = createSignal<Record<string, AgentSessionSnapshot>>({})
let subscribers = 0
let disposeSocket: (() => void) | null = null
const snapshotRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const deletedSessionIds = new Set<string>()
// Per-session bookkeeping that used to be a scan of the whole event list on every streamed frame. A
// long session holds a few thousand events and the node coalesces text deltas at 40 ms, so this ran
// about 25 times a second against thousands of rows (docs/managed-agents.md § The transcript store).
const seenEventIds = new Map<string, Set<string>>()
const usageLines = new Map<string, { at: number; turnId: string | null }>()
// A projected event used to mean "refetch the whole snapshot", which is up to 2,000 event rows and a
// JSON body parsed per row, to learn one fact. The node now sends the turn or the request that
// changed (server/sessions/runtimeEngine.ts § emitProjection). `error` is the one type left, because
// it also expires this session's pending requests and no frame names that set.
const REFETCH_EVENT_TYPES = new Set(['error'])

const byRecent = (a: AgentSession, b: AgentSession): number =>
  b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)

function upsertSession(session: AgentSession): void {
  if (deletedSessionIds.has(session.id)) return
  setSessions((current) => {
    const found = current.some((item) => item.id === session.id)
    const next = found
      ? current.map((item) => item.id === session.id ? newestManagedSession(item, session) : item)
      : [...current, session]
    return next.sort(byRecent)
  })
  setSnapshots((current) => {
    const snapshot = current[session.id]
    return snapshot
      ? { ...current, [session.id]: { ...snapshot, session: newestManagedSession(snapshot.session, session) } }
      : current
  })
  // Notices come from the row, not from the events. The node projects `attention` from the driver's
  // own events and re-broadcasts the row after every one, so the client reads a state instead of
  // guessing one per event — which is why a ten-step workflow used to raise ten "completed" rows.
  observeAttention([fromManagedSession(session, activeNodeId() ?? '')])
}

function removeSession(sessionId: string): void {
  deletedSessionIds.add(sessionId)
  const refreshTimer = snapshotRefreshTimers.get(sessionId)
  if (refreshTimer) clearTimeout(refreshTimer)
  snapshotRefreshTimers.delete(sessionId)
  seenEventIds.delete(sessionId)
  usageLines.delete(sessionId)
  setSessions((current) => current.filter((session) => session.id !== sessionId))
  setSnapshots((current) => {
    if (!(sessionId in current)) return current
    const next = { ...current }
    delete next[sessionId]
    return next
  })
}

// Both halves of a session's per-event bookkeeping, rebuilt from an array. Called once per snapshot
// load rather than once per event.
//
// It forgets the ids of usage updates that were folded away, because they are no longer in the array.
// That is deliberate rather than overlooked: the only cost is that a redelivered usage update folds a
// second time, and merging the same numbers onto the same line twice leaves the same line.
function indexEvents(sessionId: string, events: AgentEventRecord[]): void {
  seenEventIds.set(sessionId, new Set(events.map((item) => item.id)))
  const at = openUsageLine(events)
  if (at === -1) usageLines.delete(sessionId)
  else usageLines.set(sessionId, { at, turnId: events[at].turnId })
}

// Seat one event in a seq-ordered array. Almost always a push: events arrive in order, so the old
// `[...events, event].sort()` was copying a few thousand rows and sorting an already-sorted array on
// every frame. A reconnect replay can still deliver one out of order, and that has to stay correct,
// so it walks back from the tail to its seat.
function seatEvent(events: AgentEventRecord[], event: AgentEventRecord): boolean {
  const last = events.at(-1)
  if (!last || last.seq < event.seq) {
    events.push(event)
    return true
  }
  let at = events.length
  while (at > 0 && events[at - 1].seq > event.seq) at--
  events.splice(at, 0, event)
  return false
}

function appendEvent(event: AgentEventRecord): void {
  if (deletedSessionIds.has(event.sessionId)) return
  let duplicate = false
  setSnapshots((current) => {
    const snapshot = current[event.sessionId]
    if (!snapshot) return current
    let seen = seenEventIds.get(event.sessionId)
    if (!seen) {
      indexEvents(event.sessionId, snapshot.events)
      seen = seenEventIds.get(event.sessionId) ?? new Set()
    }
    if (seen.has(event.id)) {
      duplicate = true
      return current
    }
    seen.add(event.id)
    // The array is mutated rather than copied. Nothing holds it across a change — buildConversationItems
    // copies before it sorts and mergeManagedSnapshot builds new arrays — and what makes the transcript's
    // memo re-run is this signal, not the array's identity. So an append costs a push and a four-field
    // object instead of a copy of the whole session.
    if (!foldUsage(event.sessionId, snapshot.events, event)) {
      const appended = seatEvent(snapshot.events, event)
      if (!appended) indexEvents(event.sessionId, snapshot.events)
      else if (event.event.type === 'usage') {
        usageLines.set(event.sessionId, { at: snapshot.events.length - 1, turnId: event.turnId })
      }
    }
    return { ...current, [event.sessionId]: { ...snapshot } }
  })
  if (duplicate) return
  if (REFETCH_EVENT_TYPES.has(event.event.type)) scheduleSnapshotRefresh(event.sessionId)
  // An event for a session we have never seen: fetch the row, which `upsertSession` then puts
  // through the gate.
  if (!sessions().some((candidate) => candidate.id === event.sessionId))
    void managedAgentStore.loadSnapshot(event.sessionId).catch(() => undefined)
}

// A harness reports usage as a running snapshot, about 58 rows a turn, and the transcript has always
// drawn one line a turn from them. Merging on arrival keeps the event list the size of the
// conversation instead of a quarter usage rows, which is what every later projection walks. The node's
// HTTP snapshot folds by the same rule (../../shared/usageFold.ts), and conversationItems.ts still
// folds defensively. Returns true when the event was absorbed rather than seated.
function foldUsage(sessionId: string, events: AgentEventRecord[], event: AgentEventRecord): boolean {
  if (event.event.type !== 'usage') return false
  const line = usageLines.get(sessionId)
  if (!line) return false
  const open = events[line.at]
  if (!open || open.event.type !== 'usage') return false
  // A turn's last usage update can arrive after the turn is marked complete, so it carries no turn id
  // and belongs to the line it is updating. Anything else opens the next line.
  if (event.turnId !== null && event.turnId !== line.turnId) return false
  events[line.at] = {
    ...open,
    event: { type: 'usage', usage: mergeAgentUsage(open.event.usage, event.event.usage) },
  }
  return true
}

function upsertTurn(turn: AgentTurn): void {
  setSnapshots((current) => {
    const snapshot = current[turn.sessionId]
    if (!snapshot) return current
    const known = snapshot.turns.some((item) => item.id === turn.id)
    const turns = known
      ? snapshot.turns.map((item) => item.id === turn.id ? turn : item)
      : [...snapshot.turns, turn].sort((left, right) => left.ordinal - right.ordinal)
    return { ...current, [turn.sessionId]: { ...snapshot, turns } }
  })
}

function upsertRequest(request: AgentRequest): void {
  setSnapshots((current) => {
    const snapshot = current[request.sessionId]
    if (!snapshot) return current
    const known = snapshot.requests.some((item) => item.id === request.id)
    const requests = known
      ? snapshot.requests.map((item) => item.id === request.id ? request : item)
      : [...snapshot.requests, request].sort((left, right) => left.createdAt - right.createdAt)
    return { ...current, [request.sessionId]: { ...snapshot, requests } }
  })
}

function scheduleSnapshotRefresh(sessionId: string): void {
  const previous = snapshotRefreshTimers.get(sessionId)
  if (previous) clearTimeout(previous)
  snapshotRefreshTimers.set(sessionId, setTimeout(() => {
    snapshotRefreshTimers.delete(sessionId)
    void managedAgentStore.loadSnapshot(sessionId).catch(() => undefined)
  }, 50))
}

function isAgentFrame(value: unknown): value is AgentWsFrame {
  if (!value || typeof value !== 'object') return false
  const channel = (value as { channel?: unknown }).channel
  return channel === 'agent:event' || channel === 'agent:session' || channel === 'agent:turn'
    || channel === 'agent:request' || channel === 'agent:deleted'
}

function onFrame(value: unknown): void {
  if (!isAgentFrame(value)) return
  if (value.channel === 'agent:event') appendEvent(value.event)
  else if (value.channel === 'agent:session') upsertSession(value.session)
  else if (value.channel === 'agent:turn') upsertTurn(value.turn)
  else if (value.channel === 'agent:request') upsertRequest(value.request)
  else removeSession(value.sessionId)
}

export const managedAgentStore = {
  sessions,
  snapshots,
  activate(): () => void {
    subscribers++
    if (!disposeSocket) disposeSocket = wsOnAgentFrame(onFrame)
    return () => {
      subscribers--
      if (subscribers <= 0) {
        subscribers = 0
        disposeSocket?.()
        disposeSocket = null
      }
    }
  },
  async loadTask(taskId: string): Promise<AgentSession[]> {
    const page = await managedAgentApi.sessions({ taskId, archived: false })
    for (const session of page.sessions) upsertSession(session)
    return page.sessions
  },
  async loadAttention(): Promise<AgentSession[]> {
    const page = await managedAgentApi.sessions({ attention: true, archived: false })
    for (const session of page.sessions) upsertSession(session)
    return page.sessions
  },
  async loadAll(archived = false): Promise<AgentSession[]> {
    const page = await managedAgentApi.sessions({ archived })
    for (const session of page.sessions) upsertSession(session)
    return page.sessions
  },
  async loadSnapshot(sessionId: string): Promise<AgentSessionSnapshot> {
    const incoming = await managedAgentApi.snapshot(sessionId)
    if (deletedSessionIds.has(sessionId)) throw new Error('This managed agent session was deleted.')
    let snapshot = incoming
    setSnapshots((current) => {
      snapshot = mergeManagedSnapshot(current[sessionId], incoming)
      return { ...current, [sessionId]: snapshot }
    })
    indexEvents(sessionId, snapshot.events)
    upsertSession(snapshot.session)
    return snapshot
  },
  upsertSession,
  removeSession,
  // Drop every node-scoped entry. Called on a node switch (apps/desktop's scopedEviction.ts): sessions,
  // snapshots and session ids are all minted by one node, and two nodes may hold the same UUID
  // (docs/architecture-overview.md § Fleet semantics). Without this, the Agent Center renders node A's
  // roster under node B and `loadSnapshot` merges B's transcript into A's cached snapshot for a
  // colliding id.
  //
  // `deletedSessionIds` goes too: suppressing an upsert is a judgement about one node's ids, and
  // keeping it would silently swallow the new node's first events for any id that collided. The
  // attention gate clears itself on the same event (client-core deliver.ts).
  clear(): void {
    setSessions([])
    setSnapshots({})
    deletedSessionIds.clear()
    seenEventIds.clear()
    usageLines.clear()
    for (const timer of snapshotRefreshTimers.values()) clearTimeout(timer)
    snapshotRefreshTimers.clear()
  },
}

// Agent attention is workspace-wide, so the client keeps one application-lifetime subscription
// even when neither Agent Center nor a task Agent pane is currently mounted.
export function activateManagedAgentNotifications(): void {
  managedAgentStore.activate()
  // Caught, not just `void`ed. This prime runs at activation, so on a node that is still connecting,
  // or one whose agents plugin is disabled, the rejection had nothing between it and an unhandled
  // promise rejection. An empty roster is the correct degraded state; Agent Center refetches.
  managedAgentStore.loadAll().catch((error: unknown) => {
    console.warn('[agents] could not prime the managed-session roster:', error)
  })
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') managedAgentStore.clear()
})
