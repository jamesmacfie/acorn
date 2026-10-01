import type { AttentionSnapshot, AttentionState } from '@acorn/protocol/attention.ts'
import type { AgentSession } from './wire'

/** Attention outranks process state because a live provider can be waiting for the owner. */
function managedState(session: AgentSession): AttentionState {
  switch (session.attention) {
    case 'permission':
    case 'question':
    case 'workflow_gate': return 'blocked'
  }
  const settled = ['ready', 'stopped', 'archived'].includes(session.runtimeState)
  // A workflow step that fails is the run's failure to report (run-failed), not an agent's.
  if (session.kind === 'workflow') return settled || session.runtimeState === 'failed' ? 'idle' : 'working'
  if (session.attention === 'completed') return 'finished'
  if (session.attention === 'error' || session.runtimeState === 'failed') return 'error'
  return settled ? 'idle' : 'working'
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
