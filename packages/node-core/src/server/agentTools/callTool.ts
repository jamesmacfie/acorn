import { and, eq } from 'drizzle-orm'
import { isToolWithinCeiling } from '@acorn/protocol/toolPolicy.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import type { Principal } from '../middleware/auth'
import { runHook } from '../pluginHost/hooks'
import { startSpan } from '../telemetry/collector'
import { issueAgentToolProvenance } from './provenance'
import {
  agentToolContributions,
  agentToolOwner,
  isToolPermitted,
  parseToolPerms,
  TOOL_PERMS_PREF_KEY,
  ToolError,
  type AgentToolContribution,
  type ToolCallResult,
  type ToolContext,
} from './registry'

export const RUN_SCRIPT_TOOL = 'run_script'

// Who is calling, as authentication established it. `renderer` is the device surface, which reaches
// only tools that opt in with exposeToRenderer.
export type ToolCaller = { principal: Principal; db: AppDatabase; renderer: boolean }

type AvailabilityCache = Map<NonNullable<AgentToolContribution['when']>, Promise<boolean>>

const STATUS: Record<ToolError['kind'], 404 | 400 | 409 | 500 | 504> = {
  not_found: 404,
  bad_request: 400,
  conflict: 409,
  'needs-trust': 409,
  timeout: 504,
  failed: 500,
}
// Every gate refuses with the same 404, so the answer says nothing about which gate or whether the
// tool exists.
const NOT_FOUND: ToolCallResult = { ok: false, status: 404, error: 'not_found' }

export async function loadToolPerms(db: AppDatabase, userId: string) {
  const [row] = await db
    .select({ value: schema.prefs.value })
    .from(schema.prefs)
    .where(and(eq(schema.prefs.userId, userId), eq(schema.prefs.key, TOOL_PERMS_PREF_KEY)))
  return parseToolPerms(row?.value)
}

export async function toolAvailable(
  tool: AgentToolContribution,
  ctx: ToolContext,
  cache: AvailabilityCache,
): Promise<boolean> {
  if (!tool.when) return true
  let result = cache.get(tool.when)
  if (!result) {
    // Owned by the plugin that contributed the tool, so a slow `/tools` call names whose check held it.
    const span = startSpan(agentToolOwner(tool.name), {
      name: 'tool.availability',
      attrs: { seam: 'tool.availability', tool: tool.name },
    })
    result = Promise.resolve(tool.when(ctx)).then(
      (ok) => {
        span.end('ok', { available: ok })
        return ok
      },
      () => {
        span.end('error', { available: false })
        return false
      },
    )
    cache.set(tool.when, result)
  }
  return result
}

export function hasRequiredSession(principal: Principal, taskId: string, tool: AgentToolContribution): boolean {
  if (!tool.requiresSession) return true
  return (
    principal.kind === 'internal' &&
    principal.scope === 'task' &&
    !!principal.taskId &&
    principal.taskId === taskId &&
    !!principal.sessionId
  )
}

// Every check a tool call passes after authentication, in order, then the call itself. The HTTP route
// and run_script's inner calls both come through here, so a script can't skip a gate.
export async function callAgentTool(
  caller: ToolCaller,
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const registry = agentToolContributions()
  if (!registry.length) return { ok: false, status: 503, error: 'bridge-unavailable' }
  const tool = registry.find((candidate) => candidate.name === name)
  if (!tool || (caller.renderer && !tool.exposeToRenderer)) return NOT_FOUND
  const perms = await loadToolPerms(caller.db, caller.principal.userId)
  if (
    !hasRequiredSession(caller.principal, ctx.taskId, tool) ||
    !isToolPermitted(tool, perms) ||
    !isToolWithinCeiling(tool, ctx.toolCeiling)
  ) {
    return NOT_FOUND
  }
  if (!(await toolAvailable(tool, ctx, new Map()))) return NOT_FOUND
  const parsed = tool.input.safeParse(input)
  if (!parsed.success) return { ok: false, status: 400, error: 'bad_request', detail: [parsed.error.message] }
  // The last gate, after the tier check and the workflow ceiling and before anything runs: an approval
  // plugin's turn to say no (server/pluginHost/hooks.ts, docs/plugins/hooks.md § Hooks). The arguments are not in
  // the payload, deliberately — a handler that saw them would be reading the agent's work, and the
  // decision this hook exists for is about the verb.
  const verdict = await runHook('core:before-tool-call', {
    taskId: ctx.taskId,
    tool: tool.name,
    sessionId: ctx.sessionId ?? '',
  })
  if (!verdict.ok) return { ok: false, status: 409, error: 'needs-trust', detail: [`${verdict.by}: ${verdict.reason}`] }
  if (tool.requiresSession && ctx.sessionId) {
    ctx.provenanceProof = issueAgentToolProvenance(ctx.taskId, ctx.sessionId, tool.name)
  }
  if (tool.name === RUN_SCRIPT_TOOL && agentToolOwner(tool.name) === 'core') {
    // An inner call starts from the outer call's identity, never its proof, and can't start another script.
    // It stays at the script's own read tier: a harness asks the person about each write or execute call
    // by name, and inside a script it would see only run_script.
    ctx.callTool = (innerName, innerInput, call) =>
      innerName === RUN_SCRIPT_TOOL
        ? Promise.resolve(NOT_FOUND)
        : callAgentTool(caller, innerName, innerInput, {
            taskId: ctx.taskId,
            userLogin: ctx.userLogin,
            sessionId: ctx.sessionId,
            toolCeiling: { ...ctx.toolCeiling, maxRisk: 'read' },
            ...call,
          })
  }
  // Started after every gate, so the span measures the tool and not the permission check in front
  // of it, and named for the plugin that contributed the tool rather than the one whose route this
  // is: an agent tool is arbitrary work an agent asked for, and the question is whose work was slow.
  // The arguments never ride along, for the reason the hook above does not see them either.
  const span = startSpan(agentToolOwner(tool.name), {
    name: 'tool.call',
    attrs: { seam: 'tool.call', tool: tool.name, risk: tool.risk },
  })
  try {
    const value = (await tool.handler(parsed.data, ctx)) ?? null
    span.end('ok', { outcome: 'ok' })
    return { ok: true, value }
  } catch (error) {
    const kind: ToolError['kind'] = error instanceof ToolError ? error.kind : 'failed'
    span.end('error', { outcome: kind })
    return {
      ok: false,
      status: STATUS[kind],
      error: kind,
      detail: [error instanceof Error ? error.message : 'tool call failed'],
    }
  }
}
