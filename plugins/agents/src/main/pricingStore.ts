import type { PrefService } from '@acorn/node-core/main/core/prefs.ts'
import {
  agentPricingPreferenceKey,
  parseAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../shared/pricing'

export async function readAgentPricingPreferences(
  prefs: PrefService,
  userId: string,
): Promise<AgentPricingPreferences> {
  // parse, not assume: the stored value is whatever a previous version of this plugin wrote, and the
  // parser's job is to answer with the built-in table when it is absent or unreadable.
  return parseAgentPricingPreferences(await prefs.read(userId, agentPricingPreferenceKey))
}

export async function writeAgentPricingPreferences(
  prefs: PrefService,
  userId: string,
  preferences: AgentPricingPreferences,
): Promise<void> {
  await prefs.write(userId, agentPricingPreferenceKey, JSON.stringify(preferences))
}
