// The agent-tool registry (docs/next Phase 4, docs/agent-tools.md): each agent capability is
// declared ONCE as an AgentToolContribution, then PROJECTED to every surface — the MCP server
// (mcp/server.ts fetches the manifest and proxies calls), the harness HTTP route
// (server/routes/agentTools.ts) and, when `exposeToRenderer` is set, a renderer client. A handler
// returns domain data or throws a ToolError; the projections translate to their own envelopes. A
// handler that inspects which surface invoked it is a boundary bug (Phase 4 guardrail).
//
// Contributions are BUILT in the main process with their domain deps closed over (notes store,
// memory index, runtime service, browser driver, localDiff) and installed via setAgentTools —
// the same setter-injection seam the harness bridges used, so dev:node (no main) degrades to a
// clean 503 and tests can install a fake registry.
import type { z } from 'zod'
import { AGENT_TOOLS_PERMS_PREF_KEY, type ToolRisk as SharedToolRisk } from '../../shared/api'

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
    public readonly kind: 'not_found' | 'bad_request' | 'failed',
    message: string,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

// ─── Permission tiers (security §4, ux §3) ──────────────────────────────────────────────────────
// Per-tier and per-tool toggles persisted as ONE prefs slice (prefs key `agentTools.perms`). A
// per-tool toggle wins over its tier; both default to on. Consulted by every projection so turning
// a tier off removes those tools from tools/list AND rejects a direct harness call (Phase 4:
// permissions apply before workflow/profile ceilings — Phase 8 can only narrow further).
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

// ─── Registry install seam ──────────────────────────────────────────────────────────────────────

let registry: AgentToolContribution[] | null = null

export const setAgentTools = (tools: AgentToolContribution[] | null): void => {
  if (tools) {
    const names = new Set<string>()
    for (const tool of tools) {
      if (names.has(tool.name)) throw new Error(`Duplicate agent tool '${tool.name}'.`)
      names.add(tool.name)
    }
  }
  registry = tools
}
export const getAgentTools = (): AgentToolContribution[] | null => registry
