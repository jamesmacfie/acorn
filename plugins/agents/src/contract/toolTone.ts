import type { AgentToolCall } from './wire'

/** The shared semantic tone for an agent tool status. */
export const agentToolTone = (status: AgentToolCall['status']): 'ok' | 'danger' | 'muted' | 'accent' => {
  if (status === 'running') return 'accent'
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'danger'
  return 'muted'
}
