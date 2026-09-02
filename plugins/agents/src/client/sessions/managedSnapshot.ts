import type {
  AgentEventRecord,
  AgentRequest,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'
import { mergeAgentUsage } from '../../shared/usageFold'

const mergeById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) merged.set(item.id, item)
  return [...merged.values()]
}

// Events merge by id like everything else, with one exception: a usage line.
//
// Both sides now hand over one usage record a turn, folded, and both keep the first update's id — so
// the same id can carry two different running totals. The HTTP read is the authority on which events
// exist; the socket is ahead of it on a counter, because a frame can land while the request is in
// flight. Union the two, socket first, so no reported field is lost either way.
const mergeEvents = (current: AgentEventRecord[], incoming: AgentEventRecord[]): AgentEventRecord[] => {
  const held = new Map(current.map((item) => [item.id, item]))
  return mergeById<AgentEventRecord>(current, incoming).map((item) => {
    const before = held.get(item.id)
    if (item.event.type !== 'usage' || before?.event.type !== 'usage') return item
    return { ...item, event: { type: 'usage', usage: mergeAgentUsage(item.event.usage, before.event.usage) } }
  })
}

/** HTTP reads and mutation responses can resolve after a newer WebSocket projection. Sequence is the
 * authority; updatedAt breaks ties for writes such as rename that do not append an event. */
export function newestManagedSession(current: AgentSession, incoming: AgentSession): AgentSession {
  const currentIsNewer = current.lastEventSeq > incoming.lastEventSeq
    || (
      current.lastEventSeq === incoming.lastEventSeq
      && current.updatedAt > incoming.updatedAt
    )
  return currentIsNewer ? current : incoming
}

export function mergeManagedSnapshot(
  current: AgentSessionSnapshot | undefined,
  incoming: AgentSessionSnapshot,
): AgentSessionSnapshot {
  if (!current) return incoming
  const session = newestManagedSession(current.session, incoming.session)
  return {
    session,
    turns: mergeById<AgentTurn>(current.turns, incoming.turns)
      .sort((left, right) => left.ordinal - right.ordinal),
    events: mergeEvents(current.events, incoming.events).sort((left, right) => left.seq - right.seq),
    requests: mergeById<AgentRequest>(current.requests, incoming.requests)
      .sort((left, right) => left.createdAt - right.createdAt),
  }
}
