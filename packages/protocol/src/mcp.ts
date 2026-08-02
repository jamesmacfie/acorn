// MCP config inspector (docs/mcp.md): pure parse + secret masking over the agents' own config
// files (.mcp.json / .cursor/mcp.json / ~/.claude.json). Read-only — acorn never launches or
// manages these servers (the agent does; orca's stance). Masking happens in MAIN before anything
// crosses to the renderer.

export type McpServerSummary = {
  name: string
  transport: 'stdio' | 'http' | 'unknown'
  status: 'enabled' | 'disabled' | 'invalid'
  command?: string
  url?: string
  env?: Record<string, string> // secret VALUES already masked
}

// A value is masked when the key or value smells like a credential: sk-/ghp_/xox prefixes,
// *_TOKEN / *_KEY / *_SECRET keys. Keys stay intact so the user can see WHAT is configured.
const SECRET_KEY_RE = /(TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)S?$/i
const SECRET_VALUE_RE = /^(sk-|ghp_|gho_|ghs_|github_pat_|xox[bapsr]?-)/

export const maskSecret = (value: string): string => (value.length <= 4 ? '••••' : `${value.slice(0, 4)}••••`)

export function maskSecretEnv(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(env)) {
    const value = typeof raw === 'string' ? raw : String(raw)
    out[key] = SECRET_KEY_RE.test(key) || SECRET_VALUE_RE.test(value) ? maskSecret(value) : value
  }
  return out
}

// Parse one config file's JSON text. Real-world shapes: `mcpServers` at the top level (.mcp.json,
// ~/.claude.json) or `mcp.servers`/`servers` (.cursor). Invalid JSON → one 'invalid' row so the
// breakage is visible, never silent.
export function inspectMcpConfig(jsonText: string): McpServerSummary[] {
  let doc: unknown
  try {
    doc = JSON.parse(jsonText)
  } catch {
    return [{ name: '(unparseable config)', transport: 'unknown', status: 'invalid' }]
  }
  if (!doc || typeof doc !== 'object') return []
  const root = doc as Record<string, unknown>
  const serversNode =
    (root.mcpServers as Record<string, unknown> | undefined) ??
    ((root.mcp as Record<string, unknown> | undefined)?.servers as Record<string, unknown> | undefined) ??
    (root.servers as Record<string, unknown> | undefined)
  if (!serversNode || typeof serversNode !== 'object') return []

  const out: McpServerSummary[] = []
  for (const [name, raw] of Object.entries(serversNode)) {
    if (!raw || typeof raw !== 'object') {
      out.push({ name, transport: 'unknown', status: 'invalid' })
      continue
    }
    const s = raw as Record<string, unknown>
    const url = typeof s.url === 'string' ? s.url : undefined
    const command = typeof s.command === 'string' ? s.command : undefined
    const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === 'string') : []
    const typeField = typeof s.type === 'string' ? s.type : typeof s.transport === 'string' ? (s.transport as string) : undefined
    const transport: McpServerSummary['transport'] = url || typeField === 'http' || typeField === 'sse' ? 'http' : command ? 'stdio' : 'unknown'
    const disabled = s.disabled === true || s.enabled === false
    out.push({
      name,
      transport,
      status: transport === 'unknown' ? 'invalid' : disabled ? 'disabled' : 'enabled',
      command: command ? [command, ...args].join(' ') : undefined,
      url,
      env: s.env && typeof s.env === 'object' ? maskSecretEnv(s.env as Record<string, unknown>) : undefined,
    })
  }
  return out
}

// The starter file the Settings button seeds (orca's touch).
export const STARTER_MCP_JSON = `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`

// The known candidate files, relative to a root kind — the ONLY paths main will read.
export const MCP_CANDIDATES: { rel: string; root: 'worktree' | 'home' }[] = [
  { rel: '.mcp.json', root: 'worktree' },
  { rel: '.cursor/mcp.json', root: 'worktree' },
  { rel: '.claude.json', root: 'home' },
]
