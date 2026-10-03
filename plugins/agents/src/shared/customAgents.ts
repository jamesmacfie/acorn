// A custom agent: a saved start for a managed session. A harness, the provider options to start it on,
// text for its system prompt, and a ceiling on acorn's own tools (docs/managed-agents/custom-agents.md § Custom agents).
//
// The options are the same `optionId -> value` table a session default is, because model, reasoning
// and permission mode are all options a provider advertises about itself. Nothing here names one.
import { z } from 'zod'

export const customAgentsRoute = '/v1/p/agents/custom-agents'
export const customAgentsPreferenceKey = 'agents:custom-agents:v1'

// Loose enough that nobody hits them by hand, tight enough that one prefs row stays small: 50 agents of
// 16 KB instructions is under a megabyte.
export const MAX_CUSTOM_AGENTS = 50
export const MAX_CUSTOM_AGENT_INSTRUCTIONS = 16_000

const id = z.string().trim().min(1).max(200)

/** What a person or a plugin writes. The id is minted by the node for a person and by the host for a
 *  plugin, so it is not part of this. */
export const customAgentInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  glyph: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).optional(),
  providerId: id,
  profileId: id,
  options: z.record(id, z.string().max(500)).refine((value) => Object.keys(value).length <= 20, {
    message: 'A custom agent cannot set more than 20 options.',
  }).default({}),
  instructions: z.string().max(MAX_CUSTOM_AGENT_INSTRUCTIONS).optional(),
  // The highest risk of acorn tool the session may call. Absent means no ceiling beyond the owner's own
  // tool preferences. It only ever narrows (docs/agent-tools.md).
  maxToolRisk: z.enum(['read', 'write', 'execute']).optional(),
})

export type CustomAgentInput = z.infer<typeof customAgentInputSchema>

export type CustomAgent = CustomAgentInput & {
  id: string
  /** `user` is editable in Settings. `plugin` is read-only there and names the plugin that declared it. */
  source: { kind: 'user' } | { kind: 'plugin'; pluginId: string }
}

const storedSchema = z.array(customAgentInputSchema.extend({ id }))

/** The owner's own list, as stored. A row an earlier version wrote that no longer parses is dropped
 *  rather than failing every read: one broken agent should not hide the rest. */
export function parseStoredCustomAgents(raw: string | null | undefined): CustomAgent[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry): CustomAgent[] => {
    const one = storedSchema.element.safeParse(entry)
    return one.success ? [{ ...one.data, source: { kind: 'user' } }] : []
  })
}

export const serializeCustomAgents = (agents: readonly CustomAgent[]): string =>
  JSON.stringify(agents.filter((agent) => agent.source.kind === 'user').map(({ source: _source, ...agent }) => agent))

/**
 * What a session keeps of the agent it started from. Written once, when the node creates the session,
 * and read by the drivers from there rather than from the live list: editing an agent must not change
 * a running session, and a resumed Claude session has to be told exactly what it was told at creation.
 */
export type CustomAgentSnapshot = {
  id: string
  name: string
  glyph?: string
  instructions?: string
}

export const customAgentSnapshot = (agent: CustomAgent): CustomAgentSnapshot => ({
  id: agent.id,
  name: agent.name,
  ...(agent.glyph ? { glyph: agent.glyph } : {}),
  ...(agent.instructions?.trim() ? { instructions: agent.instructions.trim() } : {}),
})

/** The snapshot on a session's config, or null for a session that did not start from one. */
export function sessionCustomAgent(config: Record<string, unknown>): CustomAgentSnapshot | null {
  const value = config.customAgent
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null
  return {
    id: record.id,
    name: record.name,
    ...(typeof record.glyph === 'string' ? { glyph: record.glyph } : {}),
    ...(typeof record.instructions === 'string' && record.instructions ? { instructions: record.instructions } : {}),
  }
}

/** An agent by id, or by its name ignoring case, which is how another agent asks for one. */
export const findCustomAgent = (agents: readonly CustomAgent[], ref: string): CustomAgent | undefined =>
  agents.find((agent) => agent.id === ref)
  ?? agents.find((agent) => agent.name.toLowerCase() === ref.trim().toLowerCase())
