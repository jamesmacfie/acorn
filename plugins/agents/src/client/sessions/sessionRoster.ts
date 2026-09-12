import type {
  AgentSession,
  AgentSessionDelegation,
  AgentSubagent,
} from '@acorn/protocol/managedAgents.ts'

export type AgentSessionRosterRow =
  | {
      kind: 'managed'
      key: string
      label: string
      depth: number
      session: AgentSession
      delegation: AgentSessionDelegation | null
      managedParent: AgentSession | null
    }
  | {
      kind: 'provider-subagent'
      key: string
      label: string
      depth: number
      session: AgentSession
      subagent: AgentSubagent
    }

/**
 * Build the single flat collection Rows needs while retaining both kinds of hierarchy.
 *
 * Delegated managed sessions follow their managed parent. Provider-native subagents still follow
 * the provider session that reported them. Missing parents and malformed cycles stay selectable as
 * top-level rows instead of disappearing.
 */
export function agentSessionRoster(
  sessions: readonly AgentSession[],
  delegationBySession: Readonly<Record<string, AgentSessionDelegation>>,
): AgentSessionRosterRow[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const children = new Map<string, AgentSession[]>()
  const projectedParentId = (session: AgentSession): string | null => {
    const projection = delegationBySession[session.id]
    if (projection?.owner.kind !== 'managed') return null
    const parentId = projection.owner.parentSessionId
    return parentId !== session.id && sessionsById.has(parentId) ? parentId : null
  }
  const cycleIds = new Set<string>()
  for (const session of sessions) {
    const path: string[] = []
    const positions = new Map<string, number>()
    let current: AgentSession | undefined = session
    while (current) {
      const seenAt = positions.get(current.id)
      if (seenAt !== undefined) {
        for (const id of path.slice(seenAt)) cycleIds.add(id)
        break
      }
      positions.set(current.id, path.length)
      path.push(current.id)
      const parentId = projectedParentId(current)
      current = parentId ? sessionsById.get(parentId) : undefined
    }
  }
  const parentIdFor = (session: AgentSession): string | null =>
    cycleIds.has(session.id) ? null : projectedParentId(session)
  for (const session of sessions) {
    const parentId = parentIdFor(session)
    if (!parentId) continue
    children.set(parentId, [...children.get(parentId) ?? [], session])
  }

  const rows: AgentSessionRosterRow[] = []
  const visited = new Set<string>()
  const append = (session: AgentSession, depth: number): void => {
    if (visited.has(session.id)) return
    visited.add(session.id)
    const delegation = delegationBySession[session.id] ?? null
    const parentId = parentIdFor(session)
    const managedParent = parentId ? sessionsById.get(parentId) ?? null : null
    rows.push({
      kind: 'managed',
      key: session.id,
      label: session.title,
      depth,
      session,
      delegation,
      managedParent,
    })
    for (const subagent of session.subagents ?? []) {
      rows.push({
        kind: 'provider-subagent',
        key: `${session.id}/${subagent.id}`,
        label: subagent.title,
        depth: depth + 1,
        session,
        subagent,
      })
    }
    for (const child of children.get(session.id) ?? []) append(child, depth + 1)
  }

  for (const session of sessions) {
    if (!parentIdFor(session)) append(session, 0)
  }
  // A corrupt cycle has no root. Keep its sessions visible and let `visited` break the cycle.
  for (const session of sessions) append(session, 0)
  return rows
}

export function delegationSummary(row: Extract<AgentSessionRosterRow, { kind: 'managed' }>): string | null {
  const delegation = row.delegation
  if (!delegation) return null
  const owner = delegation.owner.kind === 'terminal'
    ? `Delegated by ${delegation.owner.label}${delegation.owner.profileId ? ` (${delegation.owner.profileId})` : ''}`
    : row.managedParent ? 'Delegated' : 'Delegated · parent unavailable'
  return `${owner} · depth ${delegation.depth} · ${delegation.isolation}`
}
