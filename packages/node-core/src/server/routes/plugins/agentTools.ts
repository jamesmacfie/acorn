import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  agentToolContributions,
  agentToolOwner,
  isToolPermitted,
  type AgentToolContribution,
  type ToolContext,
} from '../../agentTools/registry'
import { callAgentTool, hasRequiredSession, loadToolPerms, toolAvailable } from '../../agentTools/callTool'
import { getDb } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { mayActOnTask, ownerId } from '../../middleware/requireUser'
import { respondError } from '../../respond'
import { isToolWithinCeiling } from '@acorn/protocol/toolPolicy.ts'

function toolContext(c: Context<AppEnv>): ToolContext {
  const principal = c.get('principal')
  const rawCallId = c.req.header('x-acorn-tool-call-id')?.trim()
  return {
    signal: c.req.raw.signal,
    taskId: c.req.param('id')!,
    userLogin: ownerId(c),
    sessionId: principal?.sessionId,
    callId: rawCallId && rawCallId.length <= 200 ? rawCallId : undefined,
    toolCeiling: principal?.toolCeiling,
  }
}

function contributions(): readonly AgentToolContribution[] | null {
  const tools = agentToolContributions()
  return tools.length ? tools : null
}

// Match the high-level MCP SDK's schema projection: draft-07 for argument-bearing tools, and its exact
// empty-object literal for no-argument tools.
function mcpInputSchema(input: AgentToolContribution['input']): Record<string, unknown> {
  const schema = z.toJSONSchema(input, { target: 'draft-7', io: 'input' }) as Record<string, unknown>
  const properties = schema.properties as Record<string, unknown> | undefined
  if (properties && Object.keys(properties).length === 0 && !schema.required) return { type: 'object', properties: {} }
  return schema
}

async function invoke(c: Context<AppEnv>, opts: { renderer: boolean }): Promise<Response> {
  // Authorize before checking whether the registry is wired: a caller with no right to this task must
  // not learn from a 503 whether the tool surface exists on this node.
  const principal = c.get('principal')
  // 'device' is the interactive owner (the client's broker holds the bearer); 'internal' is a child this
  // node spawned. The two surfaces are mutually exclusive: an agent cannot reach renderer-only tools,
  // and the renderer cannot impersonate an agent.
  if (opts.renderer ? principal?.kind !== 'device' : principal?.kind !== 'internal')
    return respondError(c, 404, 'not_found')
  // Task scope enforced against the credential, not the URL. toolContext() below reads the taskId from
  // the path, so without this check a credential minted for task A could invoke task B's tools. 404,
  // matching every other denial here, so the surface reveals nothing about which tasks exist.
  if (!mayActOnTask(c, c.req.param('id')!)) return respondError(c, 404, 'not_found')
  const result = await callAgentTool(
    { principal: principal!, db: getDb(c.env), renderer: opts.renderer },
    c.req.param('name')!,
    await c.req.json().catch(() => ({})),
    toolContext(c),
  )
  return result.ok ? c.json(result.value) : respondError(c, result.status, result.error, result.detail)
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
    const principal = c.get('principal')!
    const perms = await loadToolPerms(getDb(c.env), principal.userId)
    const ctx = toolContext(c)
    const availability = new Map()
    const tools = []
    for (const tool of registry) {
      if (
        !hasRequiredSession(principal, ctx.taskId, tool) ||
        !isToolPermitted(tool, perms) ||
        !isToolWithinCeiling(tool, ctx.toolCeiling) ||
        !(await toolAvailable(tool, ctx, availability))
      )
        continue
      tools.push({
        name: tool.name,
        description: tool.description,
        risk: tool.risk,
        inputSchema: mcpInputSchema(tool.input),
      })
    }
    return c.json({ tools })
  })
  .post('/:id/tools/:name', (c) => invoke(c, { renderer: false }))
  .post('/:id/renderer-tools/:name', (c) => invoke(c, { renderer: true }))

export const agentToolsCatalog = new Hono<AppEnv>().get('/', (c) => {
  const registry = contributions()
  if (!registry) return respondError(c, 503, 'bridge-unavailable')
  return c.json({
    tools: registry.map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      availability: tool.whenDescription,
      owner: agentToolOwner(tool.name),
    })),
  })
})
