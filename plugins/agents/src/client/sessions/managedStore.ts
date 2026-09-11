import { agentTelemetry } from './agentTelemetry'
import { batch, createEffect, createRoot, createSignal } from 'solid-js'
import { activeNodeId, createLogger, describeError, fromManagedSession, nodeState, observeAttention, onScopeEvicted } from '@acorn/plugin-api/client'
import { wsOnAgentFrame } from './wsChannel'
import type {
  AgentEventRecord,
  AgentRequest,
  AgentSession,
  AgentSessionDelegation,
  AgentSessionSnapshot,
  AgentTurn,
  AgentWsFrame,
} from '@acorn/protocol/managedAgents.ts'
import { managedAgentApi } from './managedClient'
import { mergeManagedSnapshot, newestManagedSession } from './managedSnapshot'
import { mergeAgentUsage, openUsageLine } from '../../shared/usageFold'
import { clearComposerDraft, clearComposerDrafts } from '../composer/composerState'

// This plugin's client half has no `ctx.log`: a client context is contribution points and nothing
// else, so the tag and the owner are stated here (docs/plugin-authoring.md § Telemetry and logging).
const log = createLogger('agents', 'agents')

const [sessions, setSessions] = createSignal<AgentSession[]>([])
const [delegations, setDelegations] = createSignal<Record<string, AgentSessionDelegation>>({})
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

// How long a task's session list is served without asking the node again. See loadTask below.
const TASK_LOAD_WINDOW_MS = 5_000
const taskLoads = new Map<string, { at: number; run: Promise<AgentSession[]> }>()
const delegationLoads = new Map<string, Promise<void>>()
// A snapshot load in flight, shared rather than repeated. Deliberately not a time window like the one
// above: every caller after a mutation — a sent turn, a resolved request, a reordered queue — asks
// because it expects the answer to have changed, and a window would hand back the transcript from
// before the send. Two readers of one session in the same tick is the case this covers, which is what
// two panes open on the same session are.
const snapshotLoads = new Map<string, Promise<AgentSessionSnapshot>>()

const byRecent = (a: AgentSession, b: AgentSession): number =>
  b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)

function upsertSession(session: AgentSession): void {
  agentTelemetry.observe('agents.session.update', 1)
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

/**
 * A page of sessions in one update, instead of one update per row.
 *
 * Every loader below reads a page and then walked it a row at a time. Each row re-sorted the roster
 * and notified, so a workspace with forty sessions cost forty update cycles, and the Agents rail
 * rebuilds its whole list on each one. The per-row merge rule is `newestManagedSession`, the same one
 * `upsertSession` applies, so the two cannot drift.
 */
function upsertSessions(incoming: readonly AgentSession[]): void {
  const wanted = incoming.filter((session) => !deletedSessionIds.has(session.id))
  if (!wanted.length) return
  batch(() => {
    setSessions((current) => {
      const merged = new Map(current.map((item) => [item.id, item]))
      for (const session of wanted) {
        const held = merged.get(session.id)
        merged.set(session.id, held ? newestManagedSession(held, session) : session)
      }
      return [...merged.values()].sort(byRecent)
    })
    setSnapshots((current) => {
      let next: Record<string, AgentSessionSnapshot> | undefined
      for (const session of wanted) {
        const snapshot = current[session.id]
        if (!snapshot) continue
        next ??= { ...current }
        next[session.id] = { ...snapshot, session: newestManagedSession(snapshot.session, session) }
      }
      return next ?? current
    })
    // One call with the whole page, which is the shape this verb takes anyway: it diffs what it is
    // given against what it last saw, so a page is one diff rather than one per row.
    observeAttention(wanted.map((session) => fromManagedSession(session, activeNodeId() ?? '')))
  })
}

function replaceDelegations(
  pageSessions: readonly AgentSession[],
  incoming: readonly AgentSessionDelegation[],
): void {
  const sessionIds = new Set(pageSessions.map((session) => session.id))
  setDelegations((current) => {
    const next = Object.fromEntries(Object.entries(current).filter(([sessionId]) => !sessionIds.has(sessionId)))
    for (const delegation of incoming) {
      if (sessionIds.has(delegation.sessionId)) next[delegation.sessionId] = delegation
    }
    return next
  })
}

function removeSession(sessionId: string): void {
  deletedSessionIds.add(sessionId)
  // The unsent turn goes with the session it addressed (../composer/composerState.ts). Nothing else
  // reaps that map, and an attachment id in it names a row the node has dropped.
  clearComposerDraft(sessionId)
  const refreshTimer = snapshotRefreshTimers.get(sessionId)
  if (refreshTimer) clearTimeout(refreshTimer)
  snapshotRefreshTimers.delete(sessionId)
  seenEventIds.delete(sessionId)
  usageLines.delete(sessionId)
  setSessions((current) => current.filter((session) => session.id !== sessionId))
  setDelegations((current) => {
    if (!(sessionId in current)) return current
    const next = { ...current }
    delete next[sessionId]
    return next
  })
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
  agentTelemetry.observe('agents.event.append', 1)
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

function refreshDelegationsForTask(taskId: string): Promise<void> {
  const held = delegationLoads.get(taskId)
  if (held) return held
  const run = managedAgentApi.sessions({ taskId, archived: false })
    .then((page) => {
      upsertSessions(page.sessions)
      replaceDelegations(page.sessions, page.delegations)
    })
    .finally(() => {
      if (delegationLoads.get(taskId) === run) delegationLoads.delete(taskId)
    })
  delegationLoads.set(taskId, run)
  return run
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
  else if (value.channel === 'agent:session') {
    upsertSession(value.session)
    // The session row is published independently of its spawn projection. A fresh delegated row
    // therefore refreshes the bounded list metadata once; later runtime updates retain that separate
    // projection and cost no read.
    if (value.session.kind === 'delegated' && !delegations()[value.session.id]) {
      void refreshDelegationsForTask(value.session.taskId).catch(() => undefined)
    }
  }
  else if (value.channel === 'agent:turn') upsertTurn(value.turn)
  else if (value.channel === 'agent:request') upsertRequest(value.request)
  else removeSession(value.sessionId)
}

export const managedAgentStore = {
  sessions,
  delegations,
  snapshots,
  /**
   * Start a session on this provider and put the row in the store.
   *
   * Two surfaces open a session now — the pane's New picker and the palette's "New agent session" —
   * and neither may be the one that knows what a create looks like. The provider is named by its two
   * ids rather than by its descriptor, because the palette only carries a picked row.
   */
  async startSession(taskId: string, provider: { id: string; profileId: string }): Promise<AgentSession> {
    const session = await managedAgentApi.createSession({
      taskId,
      providerId: provider.id,
      profileId: provider.profileId,
      kind: 'interactive',
      config: {},
    })
    upsertSession(session)
    return session
  },
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
  /**
   * This task's sessions, from the node, deduplicated over a short window.
   *
   * Two callers now ask for the same list at almost the same moment: the pane model when the task
   * opens, and the rail's hover prefetch a fraction of a second earlier. The window is what makes the
   * second one free — and it is short because the socket, not this call, is what keeps the roster
   * current once a pane is watching.
   */
  loadTask(taskId: string): Promise<AgentSession[]> {
    const held = taskLoads.get(taskId)
    const cached = held && Date.now() - held.at < TASK_LOAD_WINDOW_MS
    agentTelemetry.observe('agents.roster.load', 1, '1', { cache: cached ? 'hit' : 'miss' })
    if (cached) return held.run
    // An async body rather than a `.then` chain on the call, so a caller that hands this store a
    // broken API gets a rejection like any other failure instead of a synchronous throw.
    const run: Promise<AgentSession[]> = (async () => {
      const page = await managedAgentApi.sessions({ taskId, archived: false })
      upsertSessions(page.sessions)
      replaceDelegations(page.sessions, page.delegations)
      return page.sessions
    })().catch((error: unknown) => {
      // A failed read is never remembered: the next caller has to be able to try again.
      if (taskLoads.get(taskId)?.run === run) taskLoads.delete(taskId)
      throw error
    })
    taskLoads.set(taskId, { at: Date.now(), run })
    return run
  },
  async loadAttention(): Promise<AgentSession[]> {
    const page = await managedAgentApi.sessions({ attention: true, archived: false })
    upsertSessions(page.sessions)
    replaceDelegations(page.sessions, page.delegations)
    return page.sessions
  },
  async loadAll(archived = false): Promise<AgentSession[]> {
    const page = await managedAgentApi.sessions({ archived })
    upsertSessions(page.sessions)
    replaceDelegations(page.sessions, page.delegations)
    return page.sessions
  },
  loadSnapshot(sessionId: string): Promise<AgentSessionSnapshot> {
    const held = snapshotLoads.get(sessionId)
    agentTelemetry.observe('agents.snapshot.load', 1, '1', { cache: held ? 'inflight' : 'miss' })
    if (held) return held
    const run: Promise<AgentSessionSnapshot> = (async () => {
      const incoming = await managedAgentApi.snapshot(sessionId)
      if (deletedSessionIds.has(sessionId)) throw new Error('This managed agent session was deleted.')
      let snapshot = incoming
      setSnapshots((current) => {
        snapshot = agentTelemetry.measure('agents.snapshot.merge', () => mergeManagedSnapshot(current[sessionId], incoming))
        return { ...current, [sessionId]: snapshot }
      })
      agentTelemetry.observe('agents.snapshot.events', snapshot.events.length)
      agentTelemetry.measure('agents.snapshot.index', () => indexEvents(sessionId, snapshot.events))
      upsertSession(snapshot.session)
      return snapshot
    })().finally(() => {
      // Only if the map still holds this one. A caller that asked again while this was settling owns
      // the entry now, and clearing it would leave a third caller refetching what is already in flight.
      if (snapshotLoads.get(sessionId) === run) snapshotLoads.delete(sessionId)
    })
    snapshotLoads.set(sessionId, run)
    return run
  },
  upsertSession,
  upsertSessions,
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
    setDelegations({})
    setSnapshots({})
    deletedSessionIds.clear()
    seenEventIds.clear()
    usageLines.clear()
    taskLoads.clear() // another node's tasks, and the window would serve its answers for this one
    delegationLoads.clear()
    // An in-flight read of the old node's session. It resolves after this and merges into an empty
    // store, so the entry has to go with the rest or the next reader shares a stale request.
    snapshotLoads.clear()
    clearComposerDrafts() // another node's sessions, so another node's attachment ids
    for (const timer of snapshotRefreshTimers.values()) clearTimeout(timer)
    snapshotRefreshTimers.clear()
  },
}

// Agent attention is workspace-wide, so the client keeps one application-lifetime subscription
// even when neither Agent Center nor a task Agent pane is currently mounted.
export function activateManagedAgentNotifications(): void {
  managedAgentStore.activate()
  // The prime waits for a node that can answer rather than firing at activation. `acorn` draws the
  // shell in front of a node it started and has not heard from yet (docs/tui.md § Attach or start),
  // so a prime at activation failed with ECONNREFUSED on every launch, for a request that was never
  // going to land — and printed a stack onto a terminal the renderer owns.
  //
  // Keyed on the node rather than run once, so switching nodes primes the new one. `onScopeEvicted`
  // below clears the store on that switch and nothing refilled it until Agent Center was opened.
  //
  // Still caught. A node that is reachable can still refuse this — its agents plugin may be disabled
  // — and the rejection has nothing between it and an unhandled promise rejection. An empty roster is
  // the correct degraded state; Agent Center refetches.
  let primed: string | null = null
  createRoot(() => {
    createEffect(() => {
      const nodeId = activeNodeId()
      if (!nodeId || nodeId === primed || nodeState(nodeId) === 'offline') return
      primed = nodeId
      managedAgentStore.loadAll().catch((error: unknown) => {
        log.warn(`could not prime the managed-session roster: ${describeError(error).message}`)
      })
    })
  })
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') managedAgentStore.clear()
})
