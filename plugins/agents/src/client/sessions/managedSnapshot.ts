import type {
  AgentEventRecord,
  AgentRequest,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'

const mergeById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) merged.set(item.id, item)
  return [...merged.values()]
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
    events: mergeById<AgentEventRecord>(current.events, incoming.events)
      .sort((left, right) => left.seq - right.seq),
    requests: mergeById<AgentRequest>(current.requests, incoming.requests)
      .sort((left, right) => left.createdAt - right.createdAt),
  }
}
