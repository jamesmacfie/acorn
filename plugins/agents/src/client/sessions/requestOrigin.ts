import type { AgentRequestOrigin } from '../../contract/wire.ts'

/** The origin a stored request's payload carries, or null for none or a malformed one. */
export function requestOriginOf(value: unknown): AgentRequestOrigin | null {
  if (typeof value !== 'object' || value == null) return null
  const { toolCallId, toolTitle, match, callsAgo } = value as Record<string, unknown>
  return typeof toolCallId === 'string' &&
    typeof toolTitle === 'string' &&
    typeof match === 'string' &&
    typeof callsAgo === 'number'
    ? { toolCallId, toolTitle, match, callsAgo }
    : null
}

/** The muted line under a permission card's title: which earlier result the command repeats. */
export const originLine = (origin: AgentRequestOrigin): string =>
  `${origin.match} appears in the result of "${origin.toolTitle}", ${origin.callsAgo} ${origin.callsAgo === 1 ? 'call' : 'calls'} earlier.`
