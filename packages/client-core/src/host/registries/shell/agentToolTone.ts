import type { AgentToolCall } from '@acorn/protocol/managedAgents.ts'

/** StatusDot tone for a tool call's status. Here rather than in a plugin because both the agents
 *  plugin and the changes plugin render this dot, and the changes copy was reaching for a class
 *  defined in the agents plugin's stylesheet. */
export const agentToolTone = (status: AgentToolCall['status']): 'ok' | 'warn' | 'danger' | 'muted' | 'accent' => {
  if (status === 'running') return 'accent'
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'danger'
  return 'muted'
}
