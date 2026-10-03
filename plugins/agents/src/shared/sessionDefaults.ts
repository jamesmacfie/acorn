// What a new agent session is configured with before its first turn, and where that answer is stored.
//
// Nothing here names a provider or an option. A provider already advertises its own options as
// `AgentConfigOption[]` when a session starts, so a default is a value keyed by the provider id and
// the option id it came from. A harness added later is defaultable the moment it advertises anything,
// with no change on this side.
import type { AgentConfigOption } from '../contract/wire.ts'

export const agentSessionDefaultsRoute = '/v1/p/agents/session-defaults'
export const agentSessionDefaultsPreferenceKey = 'agents:session-defaults:v1'

/** providerId to optionId to the value that option is set to. */
export type AgentDefaultValues = Record<string, Record<string, string>>

export type SpawnedAgentDefaults = {
  mode: 'inherit' | 'explicit'
  /** A harness profile, independent of the provider id used to key its options. */
  profileId: string | null
  pinned: AgentDefaultValues
}

export const defaultSpawnedAgentDefaults = (): SpawnedAgentDefaults => ({
  mode: 'inherit', profileId: null, pinned: {},
})

/**
 * "Stop idle agents after", in minutes, where 0 is Never. A closed list rather than a number field,
 * because each choice is a label the transcript repeats when it stops a session.
 */
export const AGENT_IDLE_STOP_CHOICES = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 120, label: '2 hours' },
  { minutes: 0, label: 'Never' },
] as const

/**
 * "Keep agent history for archived tasks", in days, where 0 is Forever. Past the limit, a daily
 * schedule removes the transcripts of that task's sessions for good (docs/data-layer/backup-and-retention.md § Retention).
 */
export const AGENT_ARCHIVED_HISTORY_CHOICES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: 0, label: 'Forever' },
] as const

export type AgentSessionDefaults = {
  /** Resume a paused turn when its harness reports that the account usage window has reset. */
  continueAfterUsageLimit: boolean
  /** Minutes an idle provider process is kept before the runtime stops it. 0 keeps it until the node exits. */
  stopIdleAfterMinutes: number
  /** Days an archived task keeps its agent history before the node removes it. 0 keeps it forever. */
  keepArchivedHistoryDays: number
  /**
   * Carry each change forward instead of using `pinned`. On, a model or effort switch inside a
   * session becomes the value the next session of that provider starts with.
   */
  followLastSession: boolean
  /** Written by Settings, and used when `followLastSession` is off. */
  pinned: AgentDefaultValues
  /** Written by the runtime whenever a session's option changes, and used when following is on. */
  last: AgentDefaultValues
  /** Choices for sessions opened from a diff line, independent of ordinary sessions. */
  inline: { providerId: string | null; pinned: AgentDefaultValues }
  /** Separate choices for agent_spawn, including agents in child task worktrees. */
  spawned: SpawnedAgentDefaults
}

// Following, because it needs no setup to be useful and it matches what a session switch means: you
// picked that model because it is the one you want, not only for the session you were in.
export const defaultAgentSessionDefaults = (): AgentSessionDefaults => ({
  continueAfterUsageLimit: true,
  stopIdleAfterMinutes: 30,
  // Forever, because removing history cannot be undone and has to be the owner's choice.
  keepArchivedHistoryDays: 0,
  followLastSession: true,
  pinned: {},
  last: {},
  inline: { providerId: null, pinned: {} },
  spawned: defaultSpawnedAgentDefaults(),
})

// The client is the less-trusted side and this decides which model a provider child runs, so the
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
  if (record.continueAfterUsageLimit != null && typeof record.continueAfterUsageLimit !== 'boolean') {
    errors.push('continueAfterUsageLimit must be true or false.')
  }
  if (record.stopIdleAfterMinutes != null
    && !AGENT_IDLE_STOP_CHOICES.some((choice) => choice.minutes === record.stopIdleAfterMinutes)) {
    errors.push(`stopIdleAfterMinutes must be one of ${AGENT_IDLE_STOP_CHOICES.map((choice) => choice.minutes).join(', ')}.`)
  }
  if (record.keepArchivedHistoryDays != null
    && !AGENT_ARCHIVED_HISTORY_CHOICES.some((choice) => choice.days === record.keepArchivedHistoryDays)) {
    errors.push(`keepArchivedHistoryDays must be one of ${AGENT_ARCHIVED_HISTORY_CHOICES.map((choice) => choice.days).join(', ')}.`)
  }
  if (record.followLastSession != null && typeof record.followLastSession !== 'boolean') {
    errors.push('followLastSession must be true or false.')
  }
  const pinned = record.pinned == null ? undefined : values(record.pinned, 'pinned', errors)
  const last = record.last == null ? undefined : values(record.last, 'last', errors)
  const inlineRecord = record.inline
  let spawned: SpawnedAgentDefaults | undefined
  if (record.spawned != null) {
    if (typeof record.spawned !== 'object' || Array.isArray(record.spawned)) errors.push('spawned must be an object.')
    else {
      const fields = record.spawned as Record<string, unknown>
      if (fields.mode !== 'inherit' && fields.mode !== 'explicit') errors.push('spawned.mode must be inherit or explicit.')
      if (fields.profileId != null && (typeof fields.profileId !== 'string' || fields.profileId.length > MAX_ID)) {
        errors.push('spawned.profileId must be a harness profile id.')
      }
      const pinnedSpawned = values(fields.pinned, 'spawned.pinned', errors)
      if (pinnedSpawned && (fields.mode === 'inherit' || fields.mode === 'explicit')) spawned = {
        mode: fields.mode,
        profileId: typeof fields.profileId === 'string' && fields.profileId ? fields.profileId : null,
        pinned: pinnedSpawned,
      }
    }
  }
  let inline: AgentSessionDefaults['inline'] | undefined
  if (inlineRecord != null) {
    if (typeof inlineRecord !== 'object' || Array.isArray(inlineRecord)) errors.push('inline must be an object.')
    else {
      const fields = inlineRecord as Record<string, unknown>
      if (fields.providerId != null && (typeof fields.providerId !== 'string' || fields.providerId.length > MAX_ID)) {
        errors.push('inline.providerId must be a provider id.')
      }
      const pinnedInline = values(fields.pinned, 'inline.pinned', errors)
      if (pinnedInline) inline = {
        providerId: typeof fields.providerId === 'string' && fields.providerId ? fields.providerId : null,
        pinned: pinnedInline,
      }
    }
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      ...(typeof record.continueAfterUsageLimit === 'boolean'
        ? { continueAfterUsageLimit: record.continueAfterUsageLimit }
        : {}),
      ...(typeof record.stopIdleAfterMinutes === 'number' ? { stopIdleAfterMinutes: record.stopIdleAfterMinutes } : {}),
      ...(typeof record.keepArchivedHistoryDays === 'number' ? { keepArchivedHistoryDays: record.keepArchivedHistoryDays } : {}),
      ...(typeof record.followLastSession === 'boolean' ? { followLastSession: record.followLastSession } : {}),
      ...(pinned ? { pinned } : {}),
      ...(last ? { last } : {}),
      ...(inline ? { inline } : {}),
      ...(spawned ? { spawned } : {}),
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
