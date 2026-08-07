import type { AgentSession } from '@acorn/protocol/managedAgents.ts'

// Which runtime states count as "this agent is doing something". Shared by Agent Center's `active` filter
// and its header count (AgentCenter.tsx) and by the Fleet home stat below, which is why it moved out of
// the component: two places disagreeing about what "active" means would show different numbers for the
// same node on two screens.
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

// "Needs you": anything but a settled or merely-unread attention state. Same reasoning — Agent Center's
// filter, its header count and the attention inbox all have to agree.
export const needsAttention = (session: AgentSession): boolean => !['none', 'unread'].includes(session.attention)
