// Per-owner model-pricing overrides, read and written through core's preference seam.
//
// This used to sit in server/ and query `schema.prefs` with core's database handle — one of the four
// cross-boundary reads that blocked converting this plugin. `prefs` is core's table and stays core's:
// the overrides are ordinary non-secret app state that the client also edits through the pricing pane,
// and moving the rows into agents.sqlite would have silently abandoned every owner's existing
// overrides, because a migration cannot copy across database files (docs/vNext/data.md § Plugin DBs).
//
// So it goes through `CoreServices.prefs` instead, and the file moved to main/ because it is now engine
// code rather than route code: the usage service needs the overrides with no request in hand, so the
// value is resolved by the plugin's init and reaches the HTTP layer through the usage bridge.
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
