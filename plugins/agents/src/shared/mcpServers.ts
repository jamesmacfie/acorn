// The MCP servers acorn hands to agent sessions, as the settings page and the session panel see them
// (docs/mcp.md § Your own servers).
//
// acorn owns this list and declares it to every harness through that harness's own door, so nothing
// here is written into a CLI's config file. A secret value goes to the node sealed and never comes
// back: the wire shape carries its name and whether one is stored, and an edit that leaves it out
// keeps the stored one.
import { z } from 'zod'

export const agentMcpServersRoute = '/v1/p/agents/mcp-servers'
export const agentMcpServerRoute = (name: string) => `${agentMcpServersRoute}/${encodeURIComponent(name)}`
export const agentMcpServerTestRoute = (name: string) => `${agentMcpServerRoute(name)}/test`

// acorn's own server registers under one of these two (node-core/server/mcpRegister.ts). A user server
// with the same name would shadow it in whichever harness reads names last.
export const RESERVED_MCP_SERVER_NAMES: ReadonlySet<string> = new Set(['acorn', 'acorn-dev'])

// Letters, digits, `_` and `-`: the characters every harness accepts as a server name. Codex spells
// the name as a TOML key and Claude Code folds it into `mcp__<name>__<tool>`, so anything wider breaks
// one of them.
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/
// An environment variable or header name. Loose enough for any real header, strict enough that it
// can never smuggle `=` or a newline into a process environment.
const PAIR_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/

// Bounded because every value reaches a process table or a request line.
const MAX_ARGS = 64
const MAX_PAIRS = 64
const MAX_TEXT = 4_096

export type AgentMcpTransport = 'stdio' | 'http'

/** An environment variable or header as the form sends it. A secret with no `value` keeps the stored
 *  one, so an edit never has to see a secret to leave it alone. */
export type AgentMcpPairInput = { name: string; value?: string; secret: boolean }

/** An environment variable or header as the node returns it. A secret's value is always `null`. */
export type AgentMcpPair = { name: string; value: string | null; secret: boolean }

export type AgentMcpServer = {
  name: string
  transport: AgentMcpTransport
  /** stdio only. */
  command: string | null
  args: string[]
  /** http only. */
  url: string | null
  /** stdio: the child's environment. http: request headers. */
  values: AgentMcpPair[]
  /** Switched on for a session when it is created. Each session keeps its own list after that. */
  enabled: boolean
  updatedAt: number
}

const pairInput = z.object({
  name: z.string().regex(PAIR_NAME, 'Names use letters, digits, _ and -, and start with a letter or _.'),
  value: z.string().max(MAX_TEXT).refine((value) => !/[\r\n\0]/.test(value), 'Values cannot contain line breaks.').optional(),
  secret: z.boolean(),
})

export const agentMcpServerInputSchema = z.object({
  transport: z.enum(['stdio', 'http']),
  command: z.string().trim().max(MAX_TEXT).optional(),
  args: z.array(z.string().max(MAX_TEXT)).max(MAX_ARGS).optional(),
  url: z.string().trim().max(MAX_TEXT).optional(),
  values: z.array(pairInput).max(MAX_PAIRS).optional(),
  enabled: z.boolean(),
}).superRefine((input, ctx) => {
  if (input.transport === 'stdio' && !input.command) {
    ctx.addIssue({ code: 'custom', path: ['command'], message: 'A stdio server needs a command.' })
  }
  if (input.transport === 'http') {
    let url: URL | null = null
    try { url = input.url ? new URL(input.url) : null } catch { url = null }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'An HTTP server needs an http:// or https:// URL.' })
    }
  }
  const seen = new Set<string>()
  for (const pair of input.values ?? []) {
    const key = input.transport === 'http' ? pair.name.toLowerCase() : pair.name
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['values'], message: `${pair.name} is listed twice.` })
    seen.add(key)
    if (!pair.secret && pair.value === undefined) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: `${pair.name} needs a value.` })
    }
  }
})

export type AgentMcpServerInput = z.infer<typeof agentMcpServerInputSchema>

export function validateAgentMcpServerName(name: string): string | null {
  if (!MCP_SERVER_NAME.test(name)) return 'Server names use letters, digits, _ and -, up to 64 characters.'
  if (RESERVED_MCP_SERVER_NAMES.has(name)) return `${name} is acorn's own server.`
  return null
}

export const agentMcpSessionSelectionSchema = z.object({
  enabled: z.array(z.string().regex(MCP_SERVER_NAME)).max(MAX_PAIRS),
})

/** What a server answered when the node connected to it. */
export type AgentMcpProbeResult =
  | { ok: true; tools: Array<{ name: string; description: string | null }> }
  | { ok: false; error: string }

/** One server as the harness itself reports it, which covers servers from the CLI's own config. */
export type AgentMcpReportedServer = {
  name: string
  /** connected | failed | needs_auth | starting | disabled, or whatever the harness said. */
  status: string
  toolCount: number | null
  error: string | null
}

/** The session panel's view. `reported` is null when the harness reports nothing or is not running. */
export type AgentSessionMcp = {
  servers: Array<{ name: string; transport: AgentMcpTransport; enabled: boolean }>
  reported: AgentMcpReportedServer[] | null
  /** Why the switches are locked, such as a turn in progress. */
  locked: string | null
}

/** The session's own list, as persisted on `config.mcpServers`. Anything unreadable is no servers. */
export function sessionMcpSelection(config: Record<string, unknown>): string[] {
  const value = config.mcpServers
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : []
}
