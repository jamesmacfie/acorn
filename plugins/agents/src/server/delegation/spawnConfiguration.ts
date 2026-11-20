import type { AgentConfigOption, AgentSession } from '../../contract/wire.ts'
import type { CustomAgent } from '../../shared/customAgents'
import type { SpawnedAgentDefaults } from '../../shared/sessionDefaults'

export function spawnProfileId(
  defaults: SpawnedAgentDefaults,
  parentProfileId: string,
  requested: string | undefined,
  custom: CustomAgent | null,
): string {
  return requested ?? custom?.profileId ?? (defaults.mode === 'explicit' ? defaults.profileId : null) ?? parentProfileId
}

/**
 * The options the owner chose for a child: their saved spawn defaults or a custom agent's. Inheriting
 * from the parent snapshots only its model and reasoning, because permission and collaboration modes
 * are separate authority. The calling agent's own picks are kept apart (`agentConfigOptions`).
 */
export function spawnConfigOptions(
  defaults: SpawnedAgentDefaults,
  providerId: string,
  parent: AgentSession | null,
  custom: CustomAgent | null,
): Record<string, string> {
  let base: Record<string, string> = {}
  if (defaults.mode === 'explicit') base = defaults.pinned[providerId] ?? {}
  else if (parent?.providerId === providerId && Array.isArray(parent.config.configOptions)) {
    base = Object.fromEntries(
      (parent.config.configOptions as AgentConfigOption[]).flatMap((option) =>
        (option.category === 'model' || option.category === 'reasoning') && typeof option.currentValue === 'string'
          ? [[option.id, option.currentValue]]
          : [],
      ),
    )
  }
  return { ...base, ...custom?.options }
}
