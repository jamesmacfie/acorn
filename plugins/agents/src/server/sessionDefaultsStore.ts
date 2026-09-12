import type { PrefService } from '@acorn/plugin-api/node'
import {
  agentSessionDefaultsPreferenceKey,
  parseAgentSessionDefaults,
  type AgentSessionDefaults,
} from '../shared/sessionDefaults'

export async function readAgentSessionDefaults(
  prefs: PrefService,
  userId: string,
): Promise<AgentSessionDefaults> {
  return parseAgentSessionDefaults(await prefs.read(userId, agentSessionDefaultsPreferenceKey))
}

export async function writeAgentSessionDefaults(
  prefs: PrefService,
  userId: string,
  defaults: AgentSessionDefaults,
): Promise<void> {
  await prefs.write(userId, agentSessionDefaultsPreferenceKey, JSON.stringify(defaults))
}
