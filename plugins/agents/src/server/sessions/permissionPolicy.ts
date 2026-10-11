// `agents:before-permission`: a policy plugin's chance to refuse a harness permission request before
// anyone sees it (docs/managed-agents/permission-policy.md). Veto only. A plugin can make a session
// stricter and never answer yes on the person's behalf.
//
// The engine loads this on the first permission request, not at boot
// (apps/node/scripts/check-service-budget.mjs).
import { createLogger, describeError, type PluginHookRegistry } from '@acorn/plugin-api/node'
import type {
  AgentNormalizedEvent,
  AgentPermissionOption,
  AgentRequestBlocked,
  AgentSession,
} from '../../contract/wire.ts'
import {
  BEFORE_PERMISSION_HOOK,
  type AgentBeforePermissionPayload,
  type AgentPermissionSubject,
} from '../../contract/permissionHook.ts'
import type { AgentDriverPermissionRequest } from '../drivers/types'
import type { Attendance } from './attendance'

const log = createLogger('agents', 'agents')

/** What the step needs from the engine, bound to one session, its generation, and the asking turn. */
export type PermissionRequestPorts = {
  hooks?: Pick<PluginHookRegistry, 'run'>
  session(): Promise<AgentSession>
  attendance: Attendance
  taskRoot(taskId: string): Promise<string>
  /** The materializer's bounding, which also drops everything driver-only. */
  materialize(event: AgentNormalizedEvent): Promise<AgentNormalizedEvent[]>
  /** False once the generation that asked was stopped or replaced. */
  owned(): boolean
  /** Into the provider event queue. Synchronous up to the enqueue, so nothing can overtake it. */
  accept(event: AgentNormalizedEvent): Promise<void>
}

/**
 * Run the hook, answer the driver on a veto, and record the request.
 *
 * This runs before the provider event queue, because the queue commits a session's events in order
 * and a handler's five seconds there would stall the session's other traffic. The harness is already
 * blocked on this answer, so waiting here costs it nothing.
 *
 * After the wait, a replaced generation or a request the harness withdrew records nothing: nobody was
 * shown it, so there is nothing to resolve. Otherwise the reply and the enqueue run with no await
 * between them, so whatever the provider does with a refusal reaches the queue after the request.
 */
export async function settlePermissionRequest(
  ports: PermissionRequestPorts,
  event: AgentDriverPermissionRequest,
): Promise<void> {
  const blocked = await askPolicy(ports, event)
  if (!ports.owned()) return
  const [request] = await ports.materialize(blocked ? { ...event.request, blocked } : event.request)
  if (!request || !ports.owned()) return
  if (blocked) {
    try {
      event.respond(vetoResolution(event.request.options))
    } catch {
      // Not a refusal anybody can rely on: the harness withdrew the request first, or the reply failed.
      await ports.accept({
        type: 'diagnostic',
        level: 'warning',
        message: `${blocked.by} refused a permission request, but the agent was no longer waiting for an answer.`,
      })
      return
    }
  } else if (!event.open()) return
  await ports.accept(request)
}

// Fails open: a payload that can't be built means nobody objected, and the person decides.
async function askPolicy(
  ports: PermissionRequestPorts,
  event: AgentDriverPermissionRequest,
): Promise<AgentRequestBlocked | null> {
  if (!ports.hooks) return null
  try {
    const session = await ports.session()
    const payload: AgentBeforePermissionPayload = {
      sessionId: session.id,
      taskId: session.taskId,
      requestId: event.request.requestId,
      providerId: session.providerId,
      unattended: ports.attendance !== 'attended',
      title: event.request.title,
      root: await ports.taskRoot(session.taskId).catch(() => ''),
      ...boundedSubject(event.subject),
    }
    const verdict = await ports.hooks.run(BEFORE_PERMISSION_HOOK.id, payload)
    // `by` and the capped `reason` are the host's, stamped from the handler's registration.
    return verdict.ok ? null : { by: verdict.by ?? 'a plugin', reason: verdict.reason ?? '' }
  } catch (error) {
    log.warn(`before-permission was skipped: ${describeError(error).message}`)
    return null
  }
}

// Provider-owned values, bounded before a stranger's handler reads them.
const boundedSubject = (subject: AgentPermissionSubject): AgentPermissionSubject => ({
  toolCallId: subject.toolCallId.slice(0, 2_000),
  kind: subject.kind,
  command: subject.command.slice(0, 16_384),
  paths: subject.paths.slice(0, 100).map((path) => path.slice(0, 4_096)),
})

/** The answer a veto sends: the first "reject once" option, never a lasting rule in the harness's own
 *  settings. A request that offers none is cancelled, which both drivers answer as a plain refusal. */
const vetoResolution = (options: readonly AgentPermissionOption[] | undefined): unknown => {
  const reject = options?.find((option) => option.kind === 'reject_once')
  return reject ? { optionId: reject.id } : { cancelled: true }
}
