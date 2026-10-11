// One bridge call (docs/managed-agents/loop-hooks.md): a harness hook's input, run through
// `agents:before-tool` or `agents:after-tool`, answered in the harness's own words.
//
// Every answer is a deny, a note, or nothing. A failure anywhere is nothing, so a broken bridge leaves
// the call to the harness's own checks, exactly as strict as they were without it.
//
// The engine loads this on the first bridge call, not at boot (apps/node/scripts/check-service-budget.mjs).
import { randomUUID } from 'node:crypto'
import { createLogger, describeError, type PluginHookRegistry } from '@acorn/plugin-api/node'
import type {
  AgentCapability,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentTurn,
} from '../../contract/wire.ts'
import { BEFORE_PERMISSION_HOOK } from '../../contract/permissionHook.ts'
import {
  AFTER_TOOL_HOOK,
  BEFORE_TOOL_HOOK,
  LOOP_ASK_HOLD_MS,
  LOOP_HOOK_VERSION,
  LOOP_NOTE_MAX,
  type AgentAfterToolPayload,
  type AgentLoopCoverage,
  type AgentBeforeToolPayload,
  type AgentLoopHookReply,
  type AgentLoopHookRequest,
} from '../../contract/loopHook.ts'
import { claudeHookOutput, claudeToolSubject } from '../drivers/claudeLoopHook'
import type { PendingAgentEvent } from './durableEventBuffer'
import type { ProviderGeneration } from './providerSessionLifecycle'
import { AUTONOMOUS_REQUEST_MESSAGE, persistedAttendance, sessionAttendance } from './attendance'

const log = createLogger('agents', 'agents')

/** How the person answered an ask. `expired` is nobody answering before the hold ran out. */
export type LoopAskAnswer = 'allowed' | 'refused' | 'expired'

/** What a bridge call needs from the engine. `asks` is the runtime's own map of held asks, keyed by
 *  request id, which `resolveRequest` answers. */
export type LoopHookPorts = {
  hooks?: Pick<PluginHookRegistry, 'run' | 'handlers'>
  session(sessionId: string): Promise<AgentSession | null>
  turn(turnId: string): Promise<AgentTurn | null>
  taskRoot(taskId: string): Promise<string>
  live(sessionId: string): { generation: ProviderGeneration; activeTurnId: string | null } | null
  materialize(sessionId: string, turnId: string | null, event: AgentNormalizedEvent): Promise<AgentNormalizedEvent[]>
  accept(pending: PendingAgentEvent): Promise<void>
  expire(sessionId: string, requestId: string): Promise<void>
  asks: Map<string, (resolution: unknown) => void>
}

const reply = (output: string): AgentLoopHookReply => ({ version: LOOP_HOOK_VERSION, output })

/** One bridge call, for the session and task the caller's token names. Another task's session, or one
 *  this Node doesn't have, gets no decision. */
export async function answerLoopHook(
  ports: LoopHookPorts,
  caller: { taskId: string; sessionId: string },
  request: AgentLoopHookRequest,
): Promise<AgentLoopHookReply> {
  try {
    const { hooks } = ports
    const session = await ports.session(caller.sessionId)
    if (!hooks || !session || session.taskId !== caller.taskId) return reply('')
    const subject = claudeToolSubject(request.input)
    if (!subject) return reply('')
    const point = request.event === 'PreToolUse' ? BEFORE_TOOL_HOOK.id : AFTER_TOOL_HOOK.id
    // Installed only where a point had a handler, but a handler can go away mid-session.
    if (!(await hooks.handlers(point)).length) return reply('')
    const activeTurnId = ports.live(session.id)?.activeTurnId
    const turn = activeTurnId ? await ports.turn(activeTurnId) : null
    const attendance = turn
      ? persistedAttendance(turn.effectivePolicy, { session, source: turn.source })
      : sessionAttendance(session)
    const before: AgentBeforeToolPayload = {
      sessionId: session.id,
      taskId: session.taskId,
      providerId: session.providerId,
      unattended: attendance !== 'attended',
      root: await ports.taskRoot(session.taskId).catch(() => ''),
      // Provider-owned values, bounded before a stranger's handler reads them, as for a permission.
      toolCallId: subject.toolCallId.slice(0, 2_000),
      toolName: subject.toolName.slice(0, 200),
      kind: subject.kind,
      title: subject.title.slice(0, 500),
      command: subject.command.slice(0, 16_384),
      paths: subject.paths.slice(0, 100).map((path) => path.slice(0, 4_096)),
    }
    if (request.event === 'PostToolUse') {
      // Claude sends PostToolUse only for a call that finished; a failed one is a different event.
      const verdict = await hooks.run<AgentAfterToolPayload>(AFTER_TOOL_HOOK.id, {
        ...before,
        succeeded: true,
        note: '',
      })
      return reply(claudeHookOutput('PostToolUse', { note: verdict.payload.note.trim().slice(0, LOOP_NOTE_MAX) }))
    }
    const verdict = await hooks.run(BEFORE_TOOL_HOOK.id, before)
    if (!verdict.ok) {
      return reply(
        claudeHookOutput('PreToolUse', {
          deny: `Blocked by ${verdict.by ?? 'a plugin'}: ${verdict.reason ?? ''}`.trim(),
        }),
      )
    }
    if (!verdict.ask) return reply('')
    if (attendance === 'autonomous') {
      const live = ports.live(session.id)
      if (live && live.activeTurnId === activeTurnId) {
        await ports.accept({
          sessionId: session.id,
          turnId: activeTurnId,
          generation: live.generation,
          event: { type: 'diagnostic', level: 'info', message: AUTONOMOUS_REQUEST_MESSAGE },
        })
      }
      return reply(claudeHookOutput('PreToolUse', { deny: AUTONOMOUS_REQUEST_MESSAGE }))
    }
    const { by, reason } = verdict.ask
    const answer = await holdAsk(ports, session.id, { title: before.title, by, reason })
    // An approval is no decision, so the harness's own checks still run. Never an allow.
    if (answer === 'allowed') return reply('')
    return reply(
      claudeHookOutput('PreToolUse', {
        deny:
          answer === 'refused'
            ? `The person refused this when ${by} asked them: ${reason}`
            : `Nobody answered when ${by} asked the person about this: ${reason}`,
      }),
    )
  } catch (error) {
    log.warn(`a ${request.event} bridge call was skipped: ${describeError(error).message}`)
    return reply('')
  }
}

// An ordinary permission card that names the plugin, recorded on the asking turn. The bridge call
// waits here, not in the harness's own permission flow, which runs afterward on an approval.
async function holdAsk(
  ports: LoopHookPorts,
  sessionId: string,
  question: { title: string; by: string; reason: string },
): Promise<LoopAskAnswer> {
  const live = ports.live(sessionId)
  if (!live) return 'expired'
  const { generation, activeTurnId: turnId } = live
  const requestId = randomUUID()
  // A cancelled turn expires the row at once, but the hold runs to its own timer. Release it per session
  // if a held bridge process ever matters.
  const answered = new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve(null), LOOP_ASK_HOLD_MS)
    timer.unref?.()
    ports.asks.set(requestId, (resolution) => {
      clearTimeout(timer)
      resolve(resolution)
    })
  }).finally(() => ports.asks.delete(requestId))
  const request: AgentNormalizedEvent = {
    type: 'request',
    requestId,
    kind: 'permission',
    title: question.title,
    detail: `${question.by} wants you to decide: ${question.reason}`,
    options: [
      { id: 'allow', label: 'Allow', kind: 'allow_once' },
      { id: 'reject', label: 'Reject', kind: 'reject_once' },
    ],
  }
  for (const event of await ports.materialize(sessionId, turnId, request))
    await ports.accept({ sessionId, turnId, event, generation })
  const resolution = await answered
  if (resolution == null) {
    await ports.expire(sessionId, requestId)
    return 'expired'
  }
  return (resolution as { optionId?: unknown }).optionId === 'allow' ? 'allowed' : 'refused'
}

/** What `pluginId`'s handlers reach on each installed harness, from what each harness reports. */
export async function loopCoverage(
  hooks: Pick<PluginHookRegistry, 'handlers'>,
  providers: readonly AgentProviderDescriptor[],
  pluginId: string,
): Promise<AgentLoopCoverage> {
  const [permission, before, after] = await Promise.all(
    [BEFORE_PERMISSION_HOOK.id, BEFORE_TOOL_HOOK.id, AFTER_TOOL_HOOK.id].map(async (id) =>
      (await hooks.handlers(id)).includes(pluginId),
    ),
  )
  if (!permission && !before && !after) return { harnesses: [] }
  return {
    harnesses: providers
      .filter((provider) => provider.installed)
      .map((provider) => {
        const coverage = reportedLoopCoverage(provider)
        return {
          label: provider.label,
          beforeTool:
            before && coverage.beforeTool === 'every'
              ? 'every'
              : permission && coverage.permissionRequests
                ? 'asked'
                : 'none',
          afterTool: after && coverage.afterTool,
        }
      }),
  }
}

/** Capability interpretation shared by loop hooks and passive security diagnostics. */
export function reportedLoopCoverage(provider: Pick<AgentProviderDescriptor, 'capabilities'>): {
  beforeTool: 'every' | 'asked' | 'none'
  afterTool: boolean
  permissionRequests: boolean
} {
  const reports = (capability: AgentCapability) => provider.capabilities.includes(capability)
  return {
    beforeTool: reports('loop_before_tool') ? 'every' : reports('permissions') ? 'asked' : 'none',
    afterTool: reports('loop_after_tool'),
    permissionRequests: reports('permissions'),
  }
}
