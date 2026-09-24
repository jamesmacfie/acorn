// What an agent session is doing, in five words, and which changes between them are worth telling
// someone about (docs/notifications.md).
//
// Pure: no Solid, no plugin import, no clock. Producers map their own sessions to the shared
// snapshot; the host only detects state transitions and delivers notices.
import type { AttentionEdge, AttentionEdgeKind, AttentionSnapshot, AttentionState } from '@acorn/protocol/attention.ts'

export type { AttentionState }
export type Snapshot = AttentionSnapshot
export type EdgeKind = AttentionEdgeKind
export type Edge = AttentionEdge

/** Node and source are part of the identity because two producers may use the same session id. */
export const snapshotKey = (s: Pick<Snapshot, 'nodeId' | 'sourceId' | 'sessionId'>): string =>
  `${s.nodeId}:${s.sourceId}:${s.sessionId}`

export function edgesBetween(prev: Map<string, Snapshot>, next: Snapshot[]): Edge[] {
  const out: Edge[] = []
  for (const s of next) {
    const before = prev.get(snapshotKey(s))
    // No predecessor is not news: a session that is already blocked when the roster first loads was
    // blocked before the app was open.
    if (!before || before.state === s.state) continue
    const edge = (kind: EdgeKind, title: string): Edge =>
      ({ nodeId: s.nodeId, sourceId: s.sourceId, sessionId: s.sessionId, taskId: s.taskId, kind, state: s.state, title })
    if (s.state === 'blocked') out.push(edge('agent-needs-input', `${s.title} needs you`))
    else if (s.state === 'error') out.push(edge('agent-error', `${s.title} failed`))
    // A workflow or automation turn is one step of a run, and the workflows plugin already sends
    // `run-done` for the run. Ten steps used to mean ten "finished" rows.
    else if (s.state === 'finished' && before.state === 'working' && s.notifyOnFinish)
      out.push(edge('agent-completed', `${s.title} finished`))
  }
  return out
}
