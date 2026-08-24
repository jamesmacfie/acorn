// What a new agent session is configured with before its first turn, and where that answer is stored.
//
// Nothing here names a provider or an option. A provider already advertises its own options as
// `AgentConfigOption[]` when a session starts, so a default is a value keyed by the provider id and
// the option id it came from. A harness added later is defaultable the moment it advertises anything,
// with no change on this side.
import type { AgentConfigOption } from '@acorn/protocol/managedAgents.ts'

export const agentSessionDefaultsRoute = '/v2/p/agents/session-defaults'
export const agentSessionDefaultsPreferenceKey = 'agents:session-defaults:v1'

/** providerId to optionId to the value that option is set to. */
export type AgentDefaultValues = Record<string, Record<string, string>>

export type AgentSessionDefaults = {
  /**
   * Carry each change forward instead of using `pinned`. On, a model or effort switch inside a
   * session becomes the value the next session of that provider starts with.
   */
  followLastSession: boolean
  /** Written by Settings, and used when `followLastSession` is off. */
  pinned: AgentDefaultValues
  /** Written by the runtime whenever a session's option changes, and used when following is on. */
  last: AgentDefaultValues
}

// Following, because it needs no setup to be useful and it matches what a session switch means: you
// picked that model because it is the one you want, not only for the session you were in.
export const defaultAgentSessionDefaults = (): AgentSessionDefaults => ({
  followLastSession: true,
  pinned: {},
  last: {},
})

// The renderer is the less-trusted side and this decides which model a provider child runs, so the
// bounds are here rather than trusted from the caller. They are loose enough that no real provider
// hits them: 20 providers, 20 options each.
const MAX_PROVIDERS = 20
const MAX_OPTIONS = 20
const MAX_ID = 200
const MAX_VALUE = 500

const values = (input: unknown, field: string, errors: string[]): AgentDefaultValues | null => {
  if (input == null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    errors.push(`${field} must be an object.`)
    return null
  }
  const providers = Object.entries(input as Record<string, unknown>)
  if (providers.length > MAX_PROVIDERS) {
    errors.push(`${field} cannot name more than ${MAX_PROVIDERS} providers.`)
    return null
  }
  const result: AgentDefaultValues = {}
  for (const [providerId, options] of providers) {
    if (!providerId || providerId.length > MAX_ID) {
      errors.push(`${field} has an unusable provider id.`)
      return null
    }
    if (typeof options !== 'object' || options == null || Array.isArray(options)) {
      errors.push(`${field}.${providerId} must be an object.`)
      return null
    }
    const entries = Object.entries(options as Record<string, unknown>)
    if (entries.length > MAX_OPTIONS) {
      errors.push(`${field}.${providerId} cannot name more than ${MAX_OPTIONS} options.`)
      return null
    }
    const chosen: Record<string, string> = {}
    for (const [optionId, value] of entries) {
      if (!optionId || optionId.length > MAX_ID) {
        errors.push(`${field}.${providerId} has an unusable option id.`)
        return null
      }
      if (typeof value !== 'string' || value.length > MAX_VALUE) {
        errors.push(`${field}.${providerId}.${optionId} must be a string of at most ${MAX_VALUE} characters.`)
        return null
      }
      if (value) chosen[optionId] = value
    }
    if (Object.keys(chosen).length) result[providerId] = chosen
  }
  return result
}

/**
 * Every field is optional, so the same validator reads a stored row written by an earlier version and
 * a write from the Settings page. Settings owns the checkbox and `pinned`; the runtime owns `last`.
 * Sending only what you own means neither can overwrite the other's field with a stale copy.
 */
export function validateAgentSessionDefaults(
  body: unknown,
): { ok: true; value: Partial<AgentSessionDefaults> } | { ok: false; errors: string[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['Expected an object.'] }
  }
  const record = body as Record<string, unknown>
  const errors: string[] = []
  if (record.followLastSession != null && typeof record.followLastSession !== 'boolean') {
    errors.push('followLastSession must be true or false.')
  }
  const pinned = record.pinned == null ? undefined : values(record.pinned, 'pinned', errors)
  const last = record.last == null ? undefined : values(record.last, 'last', errors)
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      ...(typeof record.followLastSession === 'boolean' ? { followLastSession: record.followLastSession } : {}),
      ...(pinned ? { pinned } : {}),
      ...(last ? { last } : {}),
    },
  }
}

/** Whatever an earlier version of this plugin wrote, or the built-in defaults when it is unreadable. */
export function parseAgentSessionDefaults(raw: string | null | undefined): AgentSessionDefaults {
  if (!raw) return defaultAgentSessionDefaults()
  try {
    const parsed = validateAgentSessionDefaults(JSON.parse(raw) as unknown)
    return { ...defaultAgentSessionDefaults(), ...(parsed.ok ? parsed.value : {}) }
  } catch {
    return defaultAgentSessionDefaults()
  }
}

/** The values a new session of this provider starts with. */
export const effectiveAgentDefaults = (
  defaults: AgentSessionDefaults,
  providerId: string,
): Record<string, string> =>
  (defaults.followLastSession ? defaults.last : defaults.pinned)[providerId] ?? {}

export function rememberAgentDefaults(
  defaults: AgentSessionDefaults,
  providerId: string,
  chosen: Record<string, string>,
): AgentSessionDefaults {
  return {
    ...defaults,
    last: {
      ...defaults.last,
      [providerId]: { ...defaults.last[providerId], ...chosen },
    },
  }
}

/**
 * The stored values folded onto what the provider advertised for this session. A value the provider
 * no longer offers is dropped rather than sent: a model that was retired between two sessions would
 * otherwise be refused on every start, and starting on the provider's own choice is the right
 * fallback. Returns the same array when nothing applies, so a caller can skip the write.
 */
export function optionsWithDefaults(
  options: readonly AgentConfigOption[],
  defaults: Record<string, string>,
): AgentConfigOption[] {
  let changed = false
  const next = options.map((option) => {
    const value = defaults[option.id]
    if (value == null || value === option.currentValue) return option
    if (!option.values.some((candidate) => candidate.value === value)) return option
    changed = true
    return { ...option, currentValue: value }
  })
  return changed ? next : options as AgentConfigOption[]
}
