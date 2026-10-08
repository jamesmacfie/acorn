import type { AgentNormalizedEvent } from '../../contract/wire.ts'
import type { AgentDriverInputRequest, AgentDriverPermissionRequest } from '../drivers/types'
import { AUTONOMOUS_REQUEST_MESSAGE, type Attendance } from './attendance'

type RequestEvent = Extract<AgentNormalizedEvent, { type: 'request' }>
type ParkedRequest = AgentDriverInputRequest | AgentDriverPermissionRequest

export type AutonomousRequestPorts = {
  attendance: Attendance
  owned(): boolean
  materialize(event: RequestEvent): Promise<AgentNormalizedEvent[]>
  accept(event: AgentNormalizedEvent): Promise<void>
  respond(requestId: string, resolution: unknown): Promise<void>
}

/** Settle an autonomous request before it can publish a pending row or wait on a policy hook. */
export async function settleAutonomousRequest(
  ports: AutonomousRequestPorts,
  event: RequestEvent | ParkedRequest,
): Promise<boolean> {
  if (ports.attendance !== 'autonomous') return false
  const parked = event.type === 'request' ? null : event
  if (parked && !parked.open()) return true
  const request = parked ? parked.request : event as RequestEvent
  const [recorded] = await ports.materialize({
    ...request, blocked: { by: 'Unattended policy', reason: AUTONOMOUS_REQUEST_MESSAGE },
  })
  if (!recorded || !ports.owned()) return true
  const reject = request.kind === 'permission' ? request.options?.find((option) => option.kind === 'reject_once') : undefined
  const resolution = reject ? { optionId: reject.id } : { cancelled: true, reason: AUTONOMOUS_REQUEST_MESSAGE }
  // Enqueue before replying: the provider may immediately continue with output or completion.
  await ports.accept(recorded)
  if (!ports.owned()) return true
  try {
    if (parked) parked.respond(resolution)
    else await ports.respond(request.requestId, resolution)
  } catch {
    await ports.accept({ type: 'diagnostic', level: 'warning',
      message: 'The unattended request was cancelled, but the provider did not acknowledge the response.' })
  }
  return true
}
