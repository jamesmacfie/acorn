import type * as schema from '../../node/schema'
import type { InlineDiffOrigin } from '../../contract/inlineDiff.ts'
import type {
  AgentEventRecord,
  AgentInputPart,
  AgentNormalizedEvent,
  AgentRequest,
  AgentSession,
  AgentSubagent,
  AgentTurn,
  AgentUsage,
} from '../../contract/wire.ts'

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (value == null) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export const mapAgentSession = (row: typeof schema.agentSessions.$inferSelect): AgentSession => ({
  id: row.id,
  taskId: row.taskId,
  providerId: row.providerId,
  profileId: row.profileId,
  kind: row.kind as AgentSession['kind'],
  origin: parseJson<InlineDiffOrigin | null>(row.originJson, null),
  driverKind: row.driverKind,
  driverVersion: row.driverVersion,
  providerSessionRef: row.providerSessionRef,
  controller: row.controller as AgentSession['controller'],
  runtimeState: row.runtimeState as AgentSession['runtimeState'],
  attention: row.attention as AgentSession['attention'],
  statusAuthority: row.statusAuthority as AgentSession['statusAuthority'],
  title: row.title,
  model: row.model,
  config: parseJson(row.configJson, {}),
  parentSessionId: row.parentSessionId,
  parentTurnId: row.parentTurnId,
  subagents: parseJson<AgentSubagent[]>(row.subagentsJson, []),
  queuedTurns: row.queuedTurns,
  lastEventSeq: row.lastEventSeq,
  lastReadSeq: row.lastReadSeq,
  lastEventAt: row.lastEventAt,
  archivedAt: row.archivedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const mapAgentTurn = (row: typeof schema.agentTurns.$inferSelect): AgentTurn => ({
  id: row.id,
  sessionId: row.sessionId,
  ordinal: row.ordinal,
  source: row.source as AgentTurn['source'],
  status: row.status as AgentTurn['status'],
  input: parseJson<AgentInputPart[]>(row.inputJson, []),
  continuationInput: parseJson<AgentInputPart[] | null>(row.continuationInputJson, null),
  notBefore: row.notBefore,
  effectivePolicy: parseJson(row.effectivePolicyJson, {}),
  providerTurnRef: row.providerTurnRef,
  stopReason: row.stopReason,
  usage: parseJson<AgentUsage | null>(row.usageJson, null),
  error: parseJson<AgentTurn['error']>(row.errorJson, null),
  attempt: row.attempt,
  createdAt: row.createdAt,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
})

export const mapAgentEvent = (row: typeof schema.agentEvents.$inferSelect): AgentEventRecord => ({
  id: row.id,
  sessionId: row.sessionId,
  turnId: row.turnId,
  seq: row.seq,
  schemaVersion: row.schemaVersion,
  event: parseJson<AgentNormalizedEvent>(row.eventJson, {
    type: 'diagnostic',
    level: 'warning',
    message: 'This event could not be decoded.',
  }),
  searchText: row.searchText,
  createdAt: row.createdAt,
})

/** A record as a client receives it, over HTTP or the socket: without `searchText`. That column is the
 *  search index's input, no client reads it, and on a tool row it repeats the title, input and output
 *  the event already carries. It was a third of the agent socket's bytes. Export and the node's own
 *  readers keep the whole record. */
export const clientEventRecord = ({ searchText: _, ...record }: AgentEventRecord): AgentEventRecord => record

export const mapAgentRequest = (row: typeof schema.agentRequests.$inferSelect): AgentRequest => ({
  id: row.id,
  sessionId: row.sessionId,
  turnId: row.turnId,
  providerRequestId: row.providerRequestId,
  kind: row.kind as AgentRequest['kind'],
  status: row.status as AgentRequest['status'],
  title: row.title,
  detail: row.detail,
  payload: parseJson(row.payloadJson, {}),
  resolution: parseJson<unknown>(row.resolutionJson, null),
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt,
})
