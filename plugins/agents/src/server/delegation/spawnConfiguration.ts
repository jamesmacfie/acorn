import type { AgentConfigOption, AgentSession } from '../../contract/wire.ts'
import type { CustomAgent } from '../../shared/customAgents'
import type { SpawnedAgentDefaults } from '../../shared/sessionDefaults'

export function spawnProfileId(
  defaults: SpawnedAgentDefaults,
  parentProfileId: string,
  requested: string | undefined,
  custom: CustomAgent | null,
): string {
  return requested ?? custom?.profileId
    ?? (defaults.mode === 'explicit' ? defaults.profileId : null)
    ?? parentProfileId
}

/** Snapshot only model and reasoning. Permission and collaboration modes are separate authority. */
export function spawnConfigOptions(
  defaults: SpawnedAgentDefaults,
  providerId: string,
  parent: AgentSession | null,
  requested: Record<string, string> | undefined,
  custom: CustomAgent | null,
): Record<string, string> {
  let base: Record<string, string> = {}
  if (defaults.mode === 'explicit') base = defaults.pinned[providerId] ?? {}
  else if (parent?.providerId === providerId && Array.isArray(parent.config.configOptions)) {
    base = Object.fromEntries((parent.config.configOptions as AgentConfigOption[]).flatMap((option) =>
      (option.category === 'model' || option.category === 'reasoning') && typeof option.currentValue === 'string'
        ? [[option.id, option.currentValue]] : []))
  }
  return { ...base, ...custom?.options, ...requested }
}
