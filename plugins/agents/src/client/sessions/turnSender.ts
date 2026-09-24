import type { AgentTurn } from '../../contract/wire.ts'

// Who a turn came from. An owner's turn on its delegated child and a child's report back to its owner
// each carry a context part of the same source naming the other agent
// (server/delegation/reports.ts). Anything else is the reader's own turn.
export const senderLabel = (turn: AgentTurn | undefined): string => {
  if (turn?.source !== 'delegation' && turn?.source !== 'delegation_report') return 'You'
  const sender = turn.input.find((part) => part.type === 'context' && part.source === turn.source)
  if (sender?.type === 'context') return `From ${sender.label}`
  return turn.source === 'delegation' ? 'From the delegating agent' : 'From a delegated agent'
}
