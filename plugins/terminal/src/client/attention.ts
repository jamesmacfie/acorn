import type { TerminalSession } from '../contract/wire'
import type { AttentionSnapshot, AttentionState } from '@acorn/protocol/attention.ts'

export function fromTerminalSession(session: TerminalSession, nodeId: string): AttentionSnapshot | null {
  if (session.kind !== 'agent') return null
  const state: AttentionState = session.status === 'exited'
    ? (session.exitCode == null || session.exitCode === 0 ? 'idle' : 'error')
    : session.agentState === 'blocked' || session.agentState === 'permission'
      ? 'blocked'
      : session.idle ? 'finished' : 'working'
  return { nodeId, sessionId: session.id, taskId: session.taskId, title: session.title, state,
    sourceId: 'terminal', notifyOnFinish: true, target: { kind: 'terminal-session', resourceId: session.id } }
}
