// How many provider turns the dispatcher may have in flight at once, and where that number is stored.
//
// Two ceilings, because they answer different questions. `provider` is counted across the whole node
// against one agent CLI, so it is what keeps a single provider account from being driven by six turns
// at once. `workspace` is counted across all providers in one workspace, so it is what stops one
// workspace taking the machine. A session still runs one turn at a time regardless of both.
export const agentConcurrencyRoute = '/v2/p/agents/concurrency'
export const agentConcurrencyPreferenceKey = 'agents:concurrency:v1'

export type AgentConcurrencyLimits = {
  provider: number
  workspace: number
}

export const defaultAgentConcurrency = (): AgentConcurrencyLimits => ({ provider: 2, workspace: 3 })

// An upper bound rather than none: each in-flight turn is a provider child process holding a worktree,
// and a mistyped 500 would spawn until the machine gave out.
export const MAX_AGENT_CONCURRENCY = 32

const limit = (value: unknown, field: string, errors: string[]): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push(`${field} must be a whole number.`)
    return null
  }
  if (value < 1 || value > MAX_AGENT_CONCURRENCY) {
    errors.push(`${field} must be between 1 and ${MAX_AGENT_CONCURRENCY}.`)
    return null
  }
  return value
}

export function validateAgentConcurrency(
  body: unknown,
): { ok: true; value: AgentConcurrencyLimits } | { ok: false; errors: string[] } {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Expected an object.'] }
  const errors: string[] = []
  const record = body as Record<string, unknown>
  const provider = limit(record.provider, 'provider', errors)
  const workspace = limit(record.workspace, 'workspace', errors)
  if (provider === null || workspace === null) return { ok: false, errors }
  return { ok: true, value: { provider, workspace } }
}

/** Whatever an earlier version of this plugin wrote, or the built-in ceilings when it is unreadable. */
export function parseAgentConcurrency(raw: string | null | undefined): AgentConcurrencyLimits {
  if (!raw) return defaultAgentConcurrency()
  try {
    const parsed = validateAgentConcurrency(JSON.parse(raw) as unknown)
    return parsed.ok ? parsed.value : defaultAgentConcurrency()
  } catch {
    return defaultAgentConcurrency()
  }
}
