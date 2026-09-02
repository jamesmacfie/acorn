// What an agent session is doing, in five words, and which changes between them are worth telling
// someone about (docs/future/notifications/model.md).
//
// Pure: no Solid, no plugin import, no clock. The node already decides what a managed session's
// attention is; this collapses that decision and the PTY tier's own vocabulary onto one scale so a
// terminal agent and a managed agent read the same way in the bell.
import type { AgentSession, AgentSessionKind } from '@acorn/protocol/managedAgents.ts'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'

export type AttentionState = 'working' | 'blocked' | 'finished' | 'error' | 'idle'

export type Snapshot = {
  nodeId: string
  sessionId: string
  taskId: string
  title: string
  state: AttentionState
  kind: AgentSessionKind | 'pty'
}

export type EdgeKind = 'agent-needs-input' | 'agent-completed' | 'agent-error'

/** A change of state worth a notice: which session, which state it reached, and what to say. */
export type Edge = {
  nodeId: string
  sessionId: string
  taskId: string
  kind: EdgeKind
  state: AttentionState
  title: string
}

/** The key both the snapshot map and the gate's hold use. Session ids are node-minted, so two nodes
 *  may hold the same one (docs/architecture-overview.md § Fleet semantics). */
export const snapshotKey = (s: Pick<Snapshot, 'nodeId' | 'sessionId'>): string => `${s.nodeId}:${s.sessionId}`

export function edgesBetween(prev: Map<string, Snapshot>, next: Snapshot[]): Edge[] {
  const out: Edge[] = []
  for (const s of next) {
    const before = prev.get(snapshotKey(s))
    // No predecessor is not news: a session that is already blocked when the roster first loads was
    // blocked before the app was open.
    if (!before || before.state === s.state) continue
    const edge = (kind: EdgeKind, title: string): Edge =>
      ({ nodeId: s.nodeId, sessionId: s.sessionId, taskId: s.taskId, kind, state: s.state, title })
    if (s.state === 'blocked') out.push(edge('agent-needs-input', `${s.title} needs you`))
    else if (s.state === 'error') out.push(edge('agent-error', `${s.title} failed`))
    // A workflow or automation turn is one step of a run, and the workflows plugin already sends
    // `run-done` for the run. Ten steps used to mean ten "finished" rows.
    else if (s.state === 'finished' && before.state === 'working' && (s.kind === 'interactive' || s.kind === 'pty'))
      out.push(edge('agent-completed', `${s.title} finished`))
  }
  return out
}

// The managed adapter. Attention wins over runtime state: the node sets `attention` from the
// driver's own events, and a session that is asking for a permission is blocked whatever its
// process is doing.
function managedState(session: AgentSession): AttentionState {
  switch (session.attention) {
    case 'permission':
    case 'question':
    case 'workflow_gate':
      return 'blocked'
    case 'completed':
      return 'finished'
    case 'error':
      return 'error'
  }
  if (session.runtimeState === 'failed') return 'error'
  const resting = session.runtimeState === 'ready' || session.runtimeState === 'stopped' || session.runtimeState === 'archived'
  return resting ? 'idle' : 'working'
}

export const fromManagedSession = (session: AgentSession, nodeId: string): Snapshot => ({
  nodeId,
  sessionId: session.id,
  taskId: session.taskId,
  title: session.title || session.providerId,
  state: managedState(session),
  kind: session.kind,
})

/** The PTY adapter. Null for a shell: a plain terminal exiting is not an agent needing you. */
export function fromTerminalSession(session: TerminalSession, nodeId: string): Snapshot | null {
  if (session.kind !== 'agent') return null
  const state: AttentionState = session.status === 'exited'
    ? (session.exitCode == null || session.exitCode === 0 ? 'idle' : 'error')
    : session.agentState === 'blocked' || session.agentState === 'permission'
      ? 'blocked'
      : session.idle ? 'finished' : 'working'
  return { nodeId, sessionId: session.id, taskId: session.taskId, title: session.title, state, kind: 'pty' }
}
