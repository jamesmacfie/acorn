import type { AgentSession } from '@acorn/protocol/managedAgents.ts'

// Which runtime states count as "this agent is doing something". Shared by Agent Center's `active`
// filter and header count and by the Fleet home stat below, which is why it moved out of the component:
// two places disagreeing about "active" would show different numbers for the same node on two screens.
export const ACTIVE_AGENT_STATES: ReadonlySet<string> = new Set([
  'creating',
  'connecting',
  'replaying',
  'working',
  'waiting',
  'cancelling',
  'reconnecting',
])

export const isActiveAgent = (session: AgentSession): boolean => ACTIVE_AGENT_STATES.has(session.runtimeState)

// "Needs you": anything but a settled or merely-unread attention state. Same reasoning, since Agent
// Center's filter, its header count and the attention inbox all have to agree.
export const needsAttention = (session: AgentSession): boolean => !['none', 'unread'].includes(session.attention)

// How each reason reads on an attention row. `permission` and `question` are the agent waiting on the
// owner, which is the inbox's purpose. `error` is a failure. `completed` is informational: the turn
// finished and nobody has looked, which is a nudge rather than a block.
export const ATTENTION_COPY: Record<string, { title: string; severity: 'info' | 'warn' | 'danger' }> = {
  permission: { title: 'wants permission', severity: 'warn' },
  question: { title: 'asked a question', severity: 'warn' },
  workflow_gate: { title: 'is waiting at a workflow gate', severity: 'warn' },
  error: { title: 'failed', severity: 'danger' },
  completed: { title: 'finished its turn', severity: 'info' },
}
