import type {
  AgentEventRecord,
  AgentRequest,
  AgentSessionSnapshot,
  AgentTurn,
} from '../../../core/shared/managedAgents'

const mergeById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) merged.set(item.id, item)
  return [...merged.values()]
}

export function mergeManagedSnapshot(
  current: AgentSessionSnapshot | undefined,
  incoming: AgentSessionSnapshot,
): AgentSessionSnapshot {
  if (!current) return incoming
  const currentSessionIsNewer = current.session.lastEventSeq > incoming.session.lastEventSeq
    || (
      current.session.lastEventSeq === incoming.session.lastEventSeq
      && current.session.updatedAt > incoming.session.updatedAt
    )
  const session = currentSessionIsNewer
    ? current.session
    : incoming.session
  return {
    session,
    turns: mergeById<AgentTurn>(current.turns, incoming.turns)
      .sort((left, right) => left.ordinal - right.ordinal),
    events: mergeById<AgentEventRecord>(current.events, incoming.events)
      .sort((left, right) => left.seq - right.seq),
    requests: mergeById<AgentRequest>(current.requests, incoming.requests)
      .sort((left, right) => left.createdAt - right.createdAt),
  }
}
