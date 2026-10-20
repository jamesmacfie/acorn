import { AGENT_SESSION_POINT } from '@acorn/protocol/extensionPoints.ts'
import { requestAnnotations } from '@acorn/plugin-api/ui/host'

/**
 * Ask every `agents:session` contributor about the sessions on screen, in one request each.
 *
 * The annotation host keeps one set of keys per contributor, so each screen has one asker: Agent
 * Center for its rows, and the Agent pane for its list and header together. The two are never on
 * screen at once. Sorted, so a list that only reorders asks nothing new. Call it inside an effect.
 */
export const requestSessionMarks = (sessionIds: readonly string[]): void =>
  requestAnnotations(
    AGENT_SESSION_POINT,
    [...sessionIds].sort().map((session) => ({ session })),
  )
