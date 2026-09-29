import { agentTelemetry } from './agentTelemetry'
import { batch, createEffect, createRoot, createSignal, untrack, type Signal } from 'solid-js'
import { activeNodeId, createLogger, describeError, nodeState, observeAttention, onScopeEvicted } from '@acorn/plugin-api/client'
import { fromManagedSession } from '../../contract/attention'
import { wsOnAgentFrame } from './wsChannel'
import type {
  AgentEventRecord,
  AgentRequest,
  AgentSession,
  AgentSessionDelegation,
  AgentSessionSnapshot,
  AgentTurn,
  AgentWsFrame,
} from '../../contract/wire.ts'
import { managedAgentApi } from './managedClient'
import { mergeManagedSnapshot, newestManagedSession } from './managedSnapshot'
import { mergeAgentUsage, openUsageLine } from '../../shared/usageFold'
import { clearComposerDraft, clearComposerDrafts } from '../composer/composerState'
import { clearReadingPlaces } from './readingPlaceStore'

// This plugin's client half has no `ctx.log`: a client context is contribution points and nothing
// else, so the tag and the owner are stated here (docs/plugin-authoring.md § Telemetry and logging).
const log = createLogger('agents', 'agents')

const [sessions, setSessions] = createSignal<AgentSession[]>([])
const [delegations, setDelegations] = createSignal<Record<string, AgentSessionDelegation>>({})
const [snapshots, setSnapshots] = createSignal<Record<string, AgentSessionSnapshot>>({})
// Each task's sessions, for readers that ask about one task. The rail marker runs once per task row,
// and it filtered the whole roster twice on every roster change. With 30 tasks and 100 sessions that
// was 6,000 comparisons for each event a streaming agent sent. A slice is its own signal, written
// only when that task's rows change, so rows for other tasks don't run at all. A slice is made on
// first read and kept, because a reader may still hold it. There is one per task anyone asked about.
const taskSlices = new Map<string, Signal<readonly AgentSession[]>>()
let subscribers = 0
let disposeSocket: (() => void) | null = null
const snapshotRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const deletedSessionIds = new Set<string>()
// Per-session bookkeeping that used to be a scan of the whole event list on every streamed frame. A
// long session holds a few thousand events and the node coalesces text deltas at 40 ms, so this ran
// about 25 times a second against thousands of rows (docs/managed-agents.md § The transcript store).
const seenEventIds = new Map<string, Set<string>>()
const usageLines = new Map<string, { at: number; turnId: string | null }>()
// How far each held snapshot's event list is known to be whole: every seq at or below this one is in
// it, or folded into a row that is. A load sets it to where its walk ended, and the next load reads on
// from here instead of from the start (see loadSnapshot). A streamed event moves it only when it is
// the very next seq. So a frame the socket lost leaves the mark at the gap, where the next read finds
// it, and a later frame can't hide it.
const completeThrough = new Map<string, number>()
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

// Which snapshots the store keeps. It used to keep every session it had read until the session was
// deleted or the node switched, so a morning of opening agent tasks held every transcript seen: eight
// real sessions came to 46 MB of JSON. Now a session keeps its snapshot while something draws it
// (`hold`), and the three most recently drawn beyond those keep theirs too, which is what makes going
// back to one of them a short read (see loadSnapshot). The rest drop their events and keep their row,
// so the rail, Agent Center and notices draw them as before, and opening one reads it from the start.
// Three because a snapshot can be large. Those eight averaged 6 MB of JSON each and one 1,200-event
// Codex session was 10 MB, so five kept would be 30 MB or more before the heap's own overhead.
const KEEP_RECENT = 3
const holds = new Map<string, number>()
// Every stored snapshot's id, least recently drawn first. A load and a release both move one to the end.
const recent = new Set<string>()

function touch(sessionId: string): void {
  recent.delete(sessionId)
  recent.add(sessionId)
}

// Forget a snapshot's events and everything kept per event. Not the row, the composer draft, the
// reading place or the event seq: those are small and belong to the session, not to its transcript.
function forgetSnapshot(sessionId: string): void {
  recent.delete(sessionId)
  const refreshTimer = snapshotRefreshTimers.get(sessionId)
  if (refreshTimer) clearTimeout(refreshTimer)
  snapshotRefreshTimers.delete(sessionId)
  seenEventIds.delete(sessionId)
  usageLines.delete(sessionId)
  completeThrough.delete(sessionId)
}

// Drop what is past the bound. A session being read is left alone: its load is about to put it back
// as the newest, and dropping it under a resumed read would only make that read start over.
function trimSnapshots(): void {
  const idle = [...recent].filter((id) => !holds.has(id) && !snapshotLoads.has(id))
  const dropped = idle.slice(0, -KEEP_RECENT)
  if (!dropped.length) return
  for (const id of dropped) forgetSnapshot(id)
  setSnapshots((current) => {
    const next = { ...current }
    for (const id of dropped) delete next[id]
    return next
  })
}

const byRecent = (a: AgentSession, b: AgentSession): number =>
  b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)

const sameRows = (a: readonly AgentSession[], b: readonly AgentSession[]): boolean =>
  a.length === b.length && a.every((session, index) => session === b[index])

// Every write to the roster, so the task slices cannot drift from it.
function setRoster(update: (current: AgentSession[]) => AgentSession[]): void {
  const previous = untrack(sessions)
  batch(() => {
    const next = setSessions(update)
    if (next === previous || !taskSlices.size) return
    const byTask = new Map<string, AgentSession[]>()
    for (const session of next) {
      if (!taskSlices.has(session.taskId)) continue
      const rows = byTask.get(session.taskId)
      if (rows) rows.push(session)
      else byTask.set(session.taskId, [session])
    }
    for (const [taskId, [slice, setSlice]] of taskSlices) {
      const rows = byTask.get(taskId) ?? []
      if (!sameRows(untrack(slice), rows)) setSlice(rows)
    }
  })
}

function sessionsForTask(taskId: string): readonly AgentSession[] {
  let slice = taskSlices.get(taskId)
  if (!slice) {
    slice = createSignal<readonly AgentSession[]>(untrack(sessions).filter((session) => session.taskId === taskId))
    taskSlices.set(taskId, slice)
  }
  return slice[0]()
}

function upsertSession(session: AgentSession): void {
  agentTelemetry.observe('agents.session.update', 1)
  if (deletedSessionIds.has(session.id)) return
  setRoster((current) => {
    const found = current.some((item) => item.id === session.id)
    const next = found
      ? current.map((item) => item.id === session.id ? newestManagedSession(item, session) : item)
      : [...current, session]
    return next.sort(byRecent)
  })
  setSnapshots((current) => {
    const snapshot = current[session.id]
    if (!snapshot) return current
    const newest = newestManagedSession(snapshot.session, session)
    return newest === snapshot.session ? current : { ...current, [session.id]: { ...snapshot, session: newest } }
  })
  // Notices come from the row, not from the events. The node projects `attention` from the driver's
  // own events and broadcasts the row whenever an event changes it, so the client reads a state instead
  // of guessing one per event — which is why a ten-step workflow used to raise ten "completed" rows.
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
    setRoster((current) => {
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
  // And where the reader was left in it, for the same reason (./readingPlaceStore.ts).
  clearReadingPlaces(sessionId)
  forgetSnapshot(sessionId)
  eventSeqs.delete(sessionId)
  setRoster((current) => current.filter((session) => session.id !== sessionId))
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

const pageReach = (events: AgentEventRecord[]): number =>
  events.reduce((reach, record) => Math.max(reach, record.foldedThroughSeq ?? record.seq), 0)

// Walk the event pages the snapshot route left behind.
//
// That route caps its event list, so a session past the cap arrives with its *oldest* events and
// nothing after them. Live that went unnoticed, because the socket appends each new event to the
// store as it lands; a reload dropped the in-memory half and refilled from the capped read, so a long
// transcript reopened at the cap and every message after it looked lost. They were never lost: the
// node writes each event to SQLite as it arrives, and this is the read catching up to the write.
//
// `lastEventSeq` on the session row counts the whole ledger, so it is what says whether there is more
// to fetch. A page that comes back empty ends the walk too, so a ledger whose rows were pruned below
// the counter costs one request rather than looping.
//
// Each page resumes from the furthest row the last one reached, not from its last record's own seq:
// the node folds a page's tool and usage updates onto the card each one opened, so the rows after that
// record may already be inside an earlier one (`foldedThroughSeq`). `from` is where the snapshot read
// started, which is where the walk starts when that read came back with no events.
async function pageToEnd(sessionId: string, snapshot: AgentSessionSnapshot, from: number): Promise<AgentEventRecord[]> {
  const events = [...snapshot.events]
  let cursor = Math.max(from, pageReach(events))
  while (cursor < snapshot.session.lastEventSeq) {
    const page = await managedAgentApi.events(sessionId, cursor)
    if (!page.events.length) break
    events.push(...page.events)
    cursor = pageReach(page.events)
  }
  return events
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

// Each session's newest event seq, from its event frames, and kept off the roster. The node sends the
// whole row only when an event changes something else on it (server/sessions/runtimeEngine.ts
// § record), so a held row's `lastEventSeq` and `updatedAt` stop at its last change. Moving them on the
// row per event woke every reader of the roster about 25 times a second: Agent Center redrew every
// row, and the streaming task's sidebar every one of its rows, to show nothing new. The pane's read mark
// is the one reader that needs the live number, and it asks here (`lastEventSeq` below).
const eventSeqs = new Map<string, Signal<number>>()

function eventSeq(sessionId: string): Signal<number> {
  let seq = eventSeqs.get(sessionId)
  if (!seq) {
    seq = createSignal(0)
    eventSeqs.set(sessionId, seq)
  }
  return seq
}

function advanceSeq(event: AgentEventRecord): void {
  if (deletedSessionIds.has(event.sessionId)) return
  const [seq, setSeq] = eventSeq(event.sessionId)
  if (event.seq > untrack(seq)) setSeq(event.seq)
}

function appendEvent(event: AgentEventRecord): void {
  agentTelemetry.observe('agents.event.append', 1)
  if (deletedSessionIds.has(event.sessionId)) return
  let duplicate = false
  let stored = false
  setSnapshots((current) => {
    const snapshot = current[event.sessionId]
    if (!snapshot) return current
    stored = true
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
    if (completeThrough.get(event.sessionId) === event.seq - 1) completeThrough.set(event.sessionId, event.seq)
    // The array is mutated rather than copied. Nothing that holds it across a change trusts it to stay
    // as it was — the transcript's projection checks it record by record against the ones it already
    // took (createConversationProjection), and mergeManagedSnapshot either builds a new array or passes
    // this one on — and what makes the transcript's memo re-run is this signal, not the array's
    // identity. So an append costs a push and a four-field object instead of a copy of the whole
    // session.
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
  // Only a snapshot the store holds has requests to expire. One it does not hold is read whole when it
  // is next drawn, and reading it now would pull a transcript nobody is looking at back into the store.
  if (stored && REFETCH_EVENT_TYPES.has(event.event.type)) scheduleSnapshotRefresh(event.sessionId)
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
  if (value.channel === 'agent:event') batch(() => {
    appendEvent(value.event)
    advanceSeq(value.event)
  })
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
  /** One task's sessions, in the roster's order. Wakes its reader only when that task's rows change. */
  sessionsForTask,
  /** The row's `lastEventSeq`, or its newest event frame's if that is further. Wakes its reader on
   *  that session's events and no other's. */
  lastEventSeq(session: AgentSession): number {
    return Math.max(session.lastEventSeq, eventSeq(session.id)[0]())
  },
  delegations,
  snapshots,
  /**
   * Start a session on this provider and put the row in the store.
   *
   * Two surfaces open a session now — the pane's New picker and the palette's "New agent session" —
   * and neither may be the one that knows what a create looks like. The provider is named by its two
   * ids rather than by its descriptor, because the palette only carries a picked row. A custom agent
   * is named by id alone: the node reads it and applies what it keeps.
   */
  async startSession(
    taskId: string,
    provider: { id: string; profileId: string },
    customAgentId?: string,
  ): Promise<AgentSession> {
    const session = await managedAgentApi.createSession({
      taskId,
      providerId: provider.id,
      profileId: provider.profileId,
      kind: 'interactive',
      ...(customAgentId ? { customAgentId } : {}),
      config: {},
    })
    upsertSession(session)
    return session
  },
  async startInlineSession(
    taskId: string,
    provider: { id: string; profileId: string },
    origin: import('../../contract/inlineDiff.ts').InlineDiffOrigin,
    requestedConfigOptions: Record<string, string>,
    idempotencyKey: string,
  ): Promise<AgentSession> {
    const session = await managedAgentApi.createSession({
      taskId,
      providerId: provider.id,
      profileId: provider.profileId,
      kind: 'interactive',
      origin,
      title: `Ask about ${origin.path}:${origin.line}`,
      config: { requestedConfigOptions },
    }, idempotencyKey)
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
  /**
   * Read a session from the node and merge it into the store.
   *
   * A session the store already holds is read on from where its events are whole
   * (`completeThrough`), not from the start. The ledger only appends, so every row below that mark
   * is one the store has already, and reading them again was the whole cost of switching back to a
   * task: 2.9 MB for a 4,000-event session, 11.7 MB and about four seconds of paging for a 16,000-event
   * one. The turns, the requests and the row still come back whole, because they change in ways no
   * frame reports: a turn queued from another window, a request expired by a stop. So this answers
   * what a full read would, for the size of the turns and requests plus whatever the socket missed.
   */
  loadSnapshot(sessionId: string): Promise<AgentSessionSnapshot> {
    const inflight = snapshotLoads.get(sessionId)
    const held = snapshots()[sessionId] ? completeThrough.get(sessionId) ?? 0 : 0
    agentTelemetry.observe('agents.snapshot.load', 1, '1', { cache: inflight ? 'inflight' : held ? 'resume' : 'miss' })
    if (inflight) return inflight
    const run: Promise<AgentSessionSnapshot> = (async () => {
      const read = async (from: number) => {
        const incoming = await managedAgentApi.snapshot(sessionId, from)
        if (deletedSessionIds.has(sessionId)) throw new Error('This managed agent session was deleted.')
        return { from, snapshot: { ...incoming, events: await pageToEnd(sessionId, incoming, from) } }
      }
      let fetched = await read(held)
      // A read that started part-way along is only half a snapshot. If the store dropped the rows
      // below it while the read was out (a node switch clears it), read the whole session instead.
      if (fetched.from && !snapshots()[sessionId]) fetched = await read(0)
      const full = fetched.snapshot
      // Complete through wherever the walk ended. The row's own `lastEventSeq` counts too: the walk
      // stops early on an empty page when rows were pruned below the counter, and those never come.
      const reached = Math.max(fetched.from, pageReach(full.events), full.session.lastEventSeq)
      let snapshot = full
      let eventsChanged = true
      // One update rather than two. The merge and the row write each hand the transcript a new
      // snapshot, and each would have re-projected it.
      batch(() => {
        setSnapshots((current) => {
          const previous = current[sessionId]
          snapshot = agentTelemetry.measure('agents.snapshot.merge', () => mergeManagedSnapshot(previous, full))
          eventsChanged = snapshot.events !== previous?.events
          return { ...current, [sessionId]: snapshot }
        })
        completeThrough.set(sessionId, Math.max(completeThrough.get(sessionId) ?? 0, reached))
        touch(sessionId)
        agentTelemetry.observe('agents.snapshot.events', snapshot.events.length)
        if (eventsChanged) agentTelemetry.measure('agents.snapshot.index', () => indexEvents(sessionId, snapshot.events))
        upsertSession(snapshot.session)
      })
      return snapshot
    })().finally(() => {
      // Only if the map still holds this one. A caller that asked again while this was settling owns
      // the entry now, and clearing it would leave a third caller refetching what is already in flight.
      if (snapshotLoads.get(sessionId) === run) snapshotLoads.delete(sessionId)
      // Here rather than at the merge, which is still inside this read and so cannot count it.
      trimSnapshots()
    })
    snapshotLoads.set(sessionId, run)
    return run
  },
  /**
   * Keep this session's snapshot while a surface draws it. Returns the release.
   *
   * The store keeps only the held snapshots and the few most recently released (`KEEP_RECENT`), so a
   * surface that reads `snapshots()` for a session holds it for as long as it reads, or the bound can
   * drop the transcript from under it. Holding reads nothing: `loadSnapshot` still does that.
   */
  hold(sessionId: string): () => void {
    holds.set(sessionId, (holds.get(sessionId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (holds.get(sessionId) ?? 1) - 1
      if (count > 0) return void holds.set(sessionId, count)
      holds.delete(sessionId)
      if (!untrack(snapshots)[sessionId]) return
      touch(sessionId)
      trimSnapshots()
    }
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
    setRoster(() => [])
    setDelegations({})
    setSnapshots({})
    deletedSessionIds.clear()
    seenEventIds.clear()
    usageLines.clear()
    completeThrough.clear()
    recent.clear() // not `holds`: those belong to mounted surfaces, and each releases its own
    eventSeqs.clear()
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
export function activateManagedAgentNotifications(): () => void {
  const release = managedAgentStore.activate()
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
  const stopPrime = createRoot((dispose) => {
    createEffect(() => {
      const nodeId = activeNodeId()
      if (!nodeId || nodeId === primed || nodeState(nodeId) === 'offline') return
      primed = nodeId
      managedAgentStore.loadAll().catch((error: unknown) => {
        log.warn(`could not prime the managed-session roster: ${describeError(error).message}`)
      })
    })
    return dispose
  })
  return () => { stopPrime(); release() }
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') managedAgentStore.clear()
})
