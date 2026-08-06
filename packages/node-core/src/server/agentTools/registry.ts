// The agent-tool registry (docs/agent-tools.md, docs/agent-tools.md): each agent capability is
// declared ONCE as an AgentToolContribution, then PROJECTED to every surface — the MCP server
// (mcp/server.ts fetches the manifest and proxies calls), the harness HTTP route
// (server/routes/agentTools.ts) and, when `exposeToRenderer` is set, a renderer client. A handler
// returns domain data or throws a ToolError; the projections translate to their own envelopes. A
// handler that inspects which surface invoked it is a boundary bug (the agent-tool registry guardrail).
//
// Contributions are BUILT where their domain deps live — inside the owning plugin's init for a
// converted plugin (`ctx.tools.register`), or in apps/node's remaining wiring for the tools whose
// plugin is not converted yet — and registered INCREMENTALLY. `tools` is the contribution point
// docs/vNext/plan.md § Phase 2 asks for, so it has to behave like `routes`: many independent
// contributors, each owning its own entries, none able to see or replace another's.
import type { z } from 'zod'
import { AGENT_TOOLS_PERMS_PREF_KEY, type ToolRisk as SharedToolRisk } from '@acorn/protocol/api.ts'

export type ToolRisk = SharedToolRisk

// Everything a handler / availability predicate needs that is NOT closed over at build time. Kept
// deliberately small: deps ride in the closure, only the invocation-scoped identity rides here.
// `userLogin` is the resolved principal (single machine user under the internal token) — the
// context-read tools scope the mirror by it, exactly as the /context route does. `sessionId` is the
// agent session's id (from the `x-acorn-session-id` header the MCP proxy sends), used to STAMP
// provenance on notes/memory writes — it is transport metadata, never a tool input arg.
export type ToolContext = { taskId: string; userLogin: string; sessionId?: string }

export type AgentToolContribution = {
  name: string
  description: string
  // Zod object schema → the MCP inputSchema (via z.toJSONSchema) and the harness-route validator.
  input: z.ZodType
  scope: 'task'
  risk: ToolRisk
  // Renderer projection is opt-in: a tool only gets a typed renderer client when it says so.
  exposeToRenderer?: boolean
  // Dynamic availability (run targets appearing mid-session). Absent → always available. Permission
  // tiers are applied separately/uniformly by the projection, NOT here.
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

// ─── Permission tiers (docs/security.md) ──────────────────────────────────────────────────────
// Per-tier and per-tool toggles persisted as ONE prefs slice (prefs key `agentTools.perms`). A
// per-tool toggle wins over its tier; both default to on. Consulted by every projection so turning
// a tier off removes those tools from tools/list AND rejects a direct harness call (the agent-tool registry:
// permissions apply before workflow/profile ceilings — workflow/profile ceilings can only narrow further).
export const TOOL_PERMS_PREF_KEY = AGENT_TOOLS_PERMS_PREF_KEY

export type ToolPerms = {
  tiers?: Partial<Record<ToolRisk, boolean>>
  tools?: Record<string, boolean>
}

export function parseToolPerms(raw: string | undefined): ToolPerms {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as ToolPerms
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function isToolPermitted(tool: Pick<AgentToolContribution, 'name' | 'risk'>, perms: ToolPerms): boolean {
  if (tool.risk === 'read') return perms.tools?.[tool.name] ?? true
  return perms.tools?.[tool.name] ?? perms.tiers?.[tool.risk] ?? true
}

// ─── The contribution point ─────────────────────────────────────────────────────────────────────

// Who contributed a tool. A plugin id for a converted plugin (bound by the plugin host, so a plugin
// cannot register on another's behalf), or 'core' for the tools apps/node still assembles itself.
// Not projected anywhere: it exists so a contributor can be REMOVED as a unit, which is the whole
// reason routes carry a `plugin` field too.
type Registration = { owner: string; tool: AgentToolContribution }

class AgentToolRegistry {
  readonly #registrations: Registration[] = []

  // Duplicate names throw, exactly as CapabilityRegistry.provide and the client-side Registry do: two
  // tools answering to one name means the winner depends on plugin init order, which nothing
  // guarantees. A silent last-write-wins here would be an agent calling a tool it did not mean to.
  register(owner: string, tool: AgentToolContribution): void {
    const clash = this.#registrations.find((r) => r.tool.name === tool.name)
    if (clash) throw new Error(`Duplicate agent tool '${tool.name}': already registered by '${clash.owner}', now by '${owner}'.`)
    this.#registrations.push({ owner, tool })
  }

  // Drop everything one owner contributed. Same reason routeRegistry.remove exists: this registry is a
  // module singleton, but registration now happens inside a plugin's init, and a process that starts the
  // service TWICE (apps/node/src/service/runtime.test.ts does, four times) would otherwise either throw
  // on the duplicate name or keep handlers closed over the FIRST boot's database handle.
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
