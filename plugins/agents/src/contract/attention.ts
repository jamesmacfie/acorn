import type { AttentionSnapshot, AttentionState } from '@acorn/protocol/attention.ts'
import type { AgentSession } from './wire'

/** Attention outranks process state because a live provider can be waiting for the owner. */
function managedState(session: AgentSession): AttentionState {
  switch (session.attention) {
    case 'permission':
    case 'question':
    case 'workflow_gate': return 'blocked'
    case 'completed': return 'finished'
    case 'error': return 'error'
  }
  if (session.runtimeState === 'failed') return 'error'
  return ['ready', 'stopped', 'archived'].includes(session.runtimeState) ? 'idle' : 'working'
}

export const fromManagedSession = (session: AgentSession, nodeId: string): AttentionSnapshot => ({
  nodeId,
  sourceId: 'agents',
  sessionId: session.id,
  taskId: session.taskId,
  title: session.title || session.providerId,
  state: managedState(session),
  notifyOnFinish: session.kind === 'interactive',
  target: { kind: 'managed-agent', resourceId: session.id },
})
