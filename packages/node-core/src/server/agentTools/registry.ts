import type { z } from 'zod'
import { AGENT_TOOLS_PERMS_PREF_KEY, type ToolRisk as SharedToolRisk } from '@acorn/protocol/api.ts'
import { toolPermissionsSchema } from '@acorn/protocol/toolPermissions.ts'

export type ToolRisk = SharedToolRisk

export type ToolContext = { taskId: string; userLogin: string; sessionId?: string }

export type AgentToolContribution = {
  name: string
  description: string
  // Zod object schema, becoming the MCP inputSchema via z.toJSONSchema and the harness-route validator.
  input: z.ZodType
  scope: 'task'
  risk: ToolRisk
  // Renderer projection is opt-in: a tool only gets a typed renderer client when it says so.
  exposeToRenderer?: boolean
  // Dynamic availability, such as run targets appearing mid-session. Absent means always available.
  // Permission tiers are applied separately and uniformly by the projection, not here.
  when?: (ctx: ToolContext) => boolean | Promise<boolean>
  whenDescription?: string
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>
}

// A handler throws ToolError to classify a domain failure; anything else it throws is 'failed'.
export class ToolError extends Error {
  constructor(
    public readonly kind: 'not_found' | 'bad_request' | 'needs-trust' | 'failed',
    message: string,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

// Permission tiers: docs/agent-tools.md § Projections.
export const TOOL_PERMS_PREF_KEY = AGENT_TOOLS_PERMS_PREF_KEY

export type ToolPerms = {
  tiers?: Partial<Record<ToolRisk, boolean>>
  tools?: Record<string, boolean>
}

export function parseToolPerms(raw: string | undefined): ToolPerms {
  if (!raw) return {}
  try {
    const parsed = toolPermissionsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function isToolPermitted(tool: Pick<AgentToolContribution, 'name' | 'risk'>, perms: ToolPerms): boolean {
  if (tool.risk === 'read') return perms.tools?.[tool.name] ?? true
  return perms.tools?.[tool.name] ?? perms.tiers?.[tool.risk] ?? true
}

// ─── The contribution point ─────────────────────────────────────────────────────────────────────
// Who contributed a tool. The plugin host binds a plugin id, so a plugin can't register on another's
// behalf; 'core' identifies core-owned tools. Not projected anywhere: it exists so a contributor can be
// removed as a unit, which is why routes carry a `plugin` field too.
type Registration = { owner: string; tool: AgentToolContribution }

class AgentToolRegistry {
  readonly #registrations: Registration[] = []

  // Duplicate names throw, like CapabilityRegistry.provide and the client-side Registry: two tools
  // answering to one name means the winner depends on plugin init order. A silent last-write-wins would
  // be an agent calling a tool it didn't mean to.
  register(owner: string, tool: AgentToolContribution): void {
    const clash = this.#registrations.find((r) => r.tool.name === tool.name)
    if (clash) throw new Error(`Duplicate agent tool '${tool.name}': already registered by '${clash.owner}', now by '${owner}'.`)
    this.#registrations.push({ owner, tool })
  }

  // Drop everything one owner contributed, for the same reason routeRegistry.remove exists. This registry
  // is a module singleton but registration happens inside a plugin's init, and a process that starts the
  // service twice would otherwise throw on the duplicate name or keep handlers closed over the first
  // boot's database handle.
  remove(owner: string): void {
    for (let i = this.#registrations.length - 1; i >= 0; i--) {
      if (this.#registrations[i].owner === owner) this.#registrations.splice(i, 1)
    }
  }

  list(): readonly AgentToolContribution[] {
    return this.#registrations.map((r) => r.tool)
  }
}

const registry = new AgentToolRegistry()

export const registerAgentTool = (owner: string, tool: AgentToolContribution): void => registry.register(owner, tool)
export const removeAgentTools = (owner: string): void => registry.remove(owner)
export const agentToolContributions = (): readonly AgentToolContribution[] => registry.list()
