import type { AgentPermissionOption } from '../../contract/wire'
import type { AgentRequestAnswer } from '../../contract/requestAnswer'
import type { ManagedAgentRuntime } from './runtime'

// `agents.requestAnswer` for one calling plugin (../../contract/requestAnswer.ts). It answers through the
// same `resolveRequest` the client's route does, with the request's own once-only option, so a harness
// sees exactly what a click on the card in Acorn sends.
export function createRequestAnswer(
  runtime: ManagedAgentRuntime,
  caller: string,
  audit: (entry: { subject: string; details: Record<string, string> }) => void,
): AgentRequestAnswer['answer'] {
  return async ({ taskId, sessionId, requestId, decision, idempotencyKey }) => {
    const session = await runtime.store.getSession(sessionId)
    if (!session || session.taskId !== taskId) return { ok: false, reason: 'not-in-task' }
    if (session.config.startedByPlugin !== caller) return { ok: false, reason: 'not-started-by-caller' }
    const request = (await runtime.store.lifecycleRequests({ taskId, sessionId })).find(
      (row) => row.requestId === requestId,
    )
    if (!request || request.status !== 'pending') return { ok: false, reason: 'not-pending' }
    const options = Array.isArray(request.payload.options) ? (request.payload.options as AgentPermissionOption[]) : []
    const option = options.find((candidate) => candidate.kind === (decision === 'allow' ? 'allow_once' : 'reject_once'))
    if (request.kind !== 'permission' || !option) return { ok: false, reason: 'no-once-option' }
    await runtime.resolveRequest(
      sessionId,
      requestId,
      { optionId: option.id },
      `plugin-answer:${caller}:${idempotencyKey}`,
    )
    audit({ subject: sessionId, details: { plugin: caller, decision, requestId } })
    return { ok: true }
  }
}
