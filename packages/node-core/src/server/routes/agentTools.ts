import { and, eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  agentToolContributions,
  isToolPermitted,
  parseToolPerms,
  TOOL_PERMS_PREF_KEY,
  ToolError,
  type AgentToolContribution,
  type ToolContext,
} from '../agentTools/registry'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { mayActOnTask, ownerId } from '../middleware/requireUser'
import { respondError } from '../respond'
import { decodeToolCeiling, isToolWithinCeiling, type ToolCeiling } from '@acorn/protocol/workflow.ts'

const STATUS: Record<ToolError['kind'], 404 | 400 | 409 | 500> = { not_found: 404, bad_request: 400, 'needs-trust': 409, failed: 500 }
type AvailabilityCache = Map<NonNullable<AgentToolContribution['when']>, Promise<boolean>>

async function loadPerms(c: Context<AppEnv>) {
  const login = ownerId(c)
  const [row] = await getDb(c.env)
    .select({ value: schema.prefs.value })
    .from(schema.prefs)
    .where(and(eq(schema.prefs.userId, login), eq(schema.prefs.key, TOOL_PERMS_PREF_KEY)))
  return parseToolPerms(row?.value)
}

function toolContext(c: Context<AppEnv>): ToolContext {
  return { taskId: c.req.param('id')!, userLogin: ownerId(c), sessionId: c.req.header('x-acorn-session-id') }
}

function workflowCeiling(c: Context<AppEnv>): ToolCeiling | undefined {
  const raw = c.req.header('x-acorn-tool-ceiling')
  return raw ? (decodeToolCeiling(raw) ?? { allow: [] }) : undefined
}

// The registry, or null when nothing has contributed a tool.
//
// An EMPTY registry is the case a null registry used to signal: no contributor assembled a tool surface
// on this node. Every projection answers 503 'bridge-unavailable' for it rather than an empty manifest,
// because an agent handed `{tools:[]}` cannot tell a node whose tool surface failed to assemble from one
// that deliberately exposes none — and the MCP proxy's degradation path is keyed on that status.
function contributions(): readonly AgentToolContribution[] | null {
  const tools = agentToolContributions()
  return tools.length ? tools : null
}

async function available(tool: AgentToolContribution, ctx: ToolContext, cache: AvailabilityCache): Promise<boolean> {
  if (!tool.when) return true
  let result = cache.get(tool.when)
  if (!result) {
    result = Promise.resolve(tool.when(ctx)).catch(() => false)
    cache.set(tool.when, result)
  }
  return result
}

// Match the high-level MCP SDK's pre-Phase-4 schema projection: draft-07 for argument-bearing
// tools, and its exact empty-object literal for no-argument tools.
export function mcpInputSchema(input: AgentToolContribution['input']): Record<string, unknown> {
  const schema = z.toJSONSchema(input, { target: 'draft-7', io: 'input' }) as Record<string, unknown>
  const properties = schema.properties as Record<string, unknown> | undefined
  if (properties && Object.keys(properties).length === 0 && !schema.required) return { type: 'object', properties: {} }
  return schema
}

async function invoke(c: Context<AppEnv>, opts: { renderer: boolean }): Promise<Response> {
  // Authorize BEFORE checking whether the registry is wired: a caller with no right to this task must
  // not learn from a 503 whether the tool surface exists on this node.
  const principal = c.get('principal')
  // 'device' is the interactive owner (the client's broker holds the bearer); 'internal' is a child this
  // node spawned. The two surfaces are mutually exclusive on purpose — an agent must not reach the
  // renderer-only tools, and the renderer must not impersonate an agent. This read 'user' before the
  // session cookie died; 'device' is the same distinction under the credential that replaced it.
  if (opts.renderer ? principal?.kind !== 'device' : principal?.kind !== 'internal') return respondError(c, 404, 'not_found')
  // Task scope enforced against the CREDENTIAL, not the URL. toolContext() below reads the taskId from
  // the path, so before internal tokens carried a task a credential minted for task A could invoke task
  // B's tools — the token said nothing about which task it belonged to
  // (server/auth/internalTokens.ts). 404, matching every other denial here, so the surface reveals
  // nothing about which tasks exist.
  if (!mayActOnTask(c, c.req.param('id')!)) return respondError(c, 404, 'not_found')
  const registry = contributions()
  if (!registry) return respondError(c, 503, 'bridge-unavailable')
  const tool = registry.find((candidate) => candidate.name === c.req.param('name'))
  if (!tool || (opts.renderer && !tool.exposeToRenderer)) return respondError(c, 404, 'not_found')
  const perms = await loadPerms(c)
  if (!isToolPermitted(tool, perms) || !isToolWithinCeiling(tool, workflowCeiling(c))) return respondError(c, 404, 'not_found')
  const ctx = toolContext(c)
  if (!(await available(tool, ctx, new Map()))) return respondError(c, 404, 'not_found')
  const parsed = tool.input.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return respondError(c, 400, 'bad_request', [parsed.error.message])
  try {
    return c.json((await tool.handler(parsed.data, ctx)) ?? null)
  } catch (error) {
    const kind: ToolError['kind'] = error instanceof ToolError ? error.kind : 'failed'
    return respondError(c, STATUS[kind], kind, [error instanceof Error ? error.message : 'tool call failed'])
  }
}

export const agentTools = new Hono<AppEnv>()
  // MCP/harness projection: INTERNAL_TOKEN only. Cookie-authenticated renderer calls have their
  // own opt-in path below, where exposeToRenderer is enforced.
  .get('/:id/tools', async (c) => {
    // Same order as invoke(): authorize, then check availability.
    if (c.get('principal')?.kind !== 'internal') return respondError(c, 404, 'not_found')
    if (!mayActOnTask(c, c.req.param('id')!)) return respondError(c, 404, 'not_found')
    const registry = contributions()
    if (!registry) return respondError(c, 503, 'bridge-unavailable')
    const perms = await loadPerms(c)
    const ctx = toolContext(c)
    const availability: AvailabilityCache = new Map()
    const ceiling = workflowCeiling(c)
    const tools = []
    for (const tool of registry) {
      if (!isToolPermitted(tool, perms) || !isToolWithinCeiling(tool, ceiling) || !(await available(tool, ctx, availability))) continue
      tools.push({ name: tool.name, description: tool.description, risk: tool.risk, inputSchema: mcpInputSchema(tool.input) })
    }
    return c.json({ tools })
  })
  .post('/:id/tools/:name', (c) => invoke(c, { renderer: false }))
  .post('/:id/renderer-tools/:name', (c) => invoke(c, { renderer: true }))

export const agentToolsCatalog = new Hono<AppEnv>().get('/', (c) => {
  const registry = contributions()
  if (!registry) return respondError(c, 503, 'bridge-unavailable')
  return c.json({
    tools: registry.map((tool) => ({ name: tool.name, description: tool.description, risk: tool.risk, availability: tool.whenDescription })),
  })
})
