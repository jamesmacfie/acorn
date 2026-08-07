import { createSignal } from 'solid-js'
import { pushManagedAgentNotice } from '@acorn/client-core/notifications/notifications.ts'
import { wsOnAgentFrame } from '@acorn/client-core/wsClient.ts'
import type { AgentEventRecord, AgentSession, AgentSessionSnapshot, AgentWsFrame } from '@acorn/protocol/managedAgents.ts'
import { managedAgentApi } from './managedClient'
import { mergeManagedSnapshot } from './managedSnapshot'

const [sessions, setSessions] = createSignal<AgentSession[]>([])
const [snapshots, setSnapshots] = createSignal<Record<string, AgentSessionSnapshot>>({})
let subscribers = 0
let disposeSocket: (() => void) | null = null
const noticedEventIds = new Set<string>()
const snapshotRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const deletedSessionIds = new Set<string>()
const PROJECTED_EVENT_TYPES = new Set([
  'user_message',
  'request',
  'request_resolved',
  'turn_completed',
  'error',
])

const byRecent = (a: AgentSession, b: AgentSession): number =>
  b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)

function upsertSession(session: AgentSession): void {
  if (deletedSessionIds.has(session.id)) return
  setSessions((current) => {
    const found = current.some((item) => item.id === session.id)
    const next = found
      ? current.map((item) => item.id === session.id ? session : item)
      : [...current, session]
    return next.sort(byRecent)
  })
  setSnapshots((current) => {
    const snapshot = current[session.id]
    return snapshot
      ? { ...current, [session.id]: { ...snapshot, session } }
      : current
  })
}

function removeSession(sessionId: string): void {
  deletedSessionIds.add(sessionId)
  const refreshTimer = snapshotRefreshTimers.get(sessionId)
  if (refreshTimer) clearTimeout(refreshTimer)
  snapshotRefreshTimers.delete(sessionId)
  setSessions((current) => current.filter((session) => session.id !== sessionId))
  setSnapshots((current) => {
    if (!(sessionId in current)) return current
    const next = { ...current }
    delete next[sessionId]
    return next
  })
}

function notifyForEvent(event: AgentEventRecord, session: AgentSession): void {
  if (noticedEventIds.has(event.id)) return
  noticedEventIds.add(event.id)
  if (event.event.type === 'request') {
    pushManagedAgentNotice({
      taskId: session.taskId,
      sessionId: session.id,
      requestId: event.event.requestId,
      kind: 'agent-needs-input',
      title: event.event.kind === 'permission'
        ? 'Managed agent needs approval'
        : event.event.kind === 'workflow_gate'
          ? 'Managed workflow needs approval'
          : 'Managed agent has a question',
    })
  } else if (event.event.type === 'turn_completed') {
    pushManagedAgentNotice({
      taskId: session.taskId,
      sessionId: session.id,
      kind: 'agent-completed',
      title: 'Managed agent completed a turn',
    })
  } else if (event.event.type === 'error') {
    pushManagedAgentNotice({
      taskId: session.taskId,
      sessionId: session.id,
      kind: 'agent-error',
      title: 'Managed agent needs attention',
    })
  }
}

function appendEvent(event: AgentEventRecord): void {
  if (deletedSessionIds.has(event.sessionId)) return
  const duplicate = snapshots()[event.sessionId]?.events.some((item) => item.id === event.id) ?? false
  setSnapshots((current) => {
    const snapshot = current[event.sessionId]
    if (!snapshot || snapshot.events.some((item) => item.seq === event.seq)) return current
    return {
      ...current,
      [event.sessionId]: {
        ...snapshot,
        events: [...snapshot.events, event].sort((a, b) => a.seq - b.seq),
      },
    }
  })
  if (duplicate) return
  if (PROJECTED_EVENT_TYPES.has(event.event.type)) scheduleSnapshotRefresh(event.sessionId)
  const session = sessions().find((candidate) => candidate.id === event.sessionId)
  if (session) notifyForEvent(event, session)
  else void managedAgentStore.loadSnapshot(event.sessionId)
    .then((snapshot) => notifyForEvent(event, snapshot.session))
    .catch(() => undefined)
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
  return channel === 'agent:event' || channel === 'agent:session' || channel === 'agent:deleted'
}

function onFrame(value: unknown): void {
  if (!isAgentFrame(value)) return
  if (value.channel === 'agent:event') appendEvent(value.event)
  else if (value.channel === 'agent:session') upsertSession(value.session)
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
    upsertSession(snapshot.session)
    return snapshot
  },
  upsertSession,
  removeSession,
  // Drop every node-scoped entry. Called on a node switch (apps/desktop's scopedEviction.ts): sessions,
  // snapshots and session ids are all minted by ONE node, and two nodes may hold the same UUID by
  // construction (docs/vNext/architecture.md § Fleet semantics) — so without this the Agent Center
  // rendered node A's roster under node B and `loadSnapshot` could merge B's transcript into A's cached
  // snapshot for a colliding id.
  //
  // The dedupe sets go too: `noticedEventIds` suppressing a notice and `deletedSessionIds` suppressing an
  // upsert are both judgements about one node's ids, and keeping them would silently swallow the new
  // node's first events for any id that collided.
  clear(): void {
    setSessions([])
    setSnapshots({})
    noticedEventIds.clear()
    deletedSessionIds.clear()
    for (const timer of snapshotRefreshTimers.values()) clearTimeout(timer)
    snapshotRefreshTimers.clear()
  },
}

// Agent attention is workspace-wide, so the renderer keeps one application-lifetime subscription
// even when neither Agent Center nor a task Agent pane is currently mounted.
export function activateManagedAgentNotifications(): void {
  managedAgentStore.activate()
  // Caught, not just `void`ed. This prime runs at activation, so on a node that is still connecting —
  // or one whose agents plugin is disabled — the rejection had nothing between it and an unhandled
  // promise rejection. An empty roster is the correct degraded state; Agent Center refetches.
  managedAgentStore.loadAll().catch((error: unknown) => {
    console.warn('[agents] could not prime the managed-session roster:', error)
  })
}
