import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import {
  agentPricingPreferenceKey,
  parseAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../shared/pricing'

export async function readAgentPricingPreferences(
  db: AppDatabase,
  userId: string,
): Promise<AgentPricingPreferences> {
  const [row] = await db
    .select({ value: schema.prefs.value })
    .from(schema.prefs)
    .where(and(eq(schema.prefs.userId, userId), eq(schema.prefs.key, agentPricingPreferenceKey)))
    .limit(1)
  return parseAgentPricingPreferences(row?.value)
}

export async function writeAgentPricingPreferences(
  db: AppDatabase,
  userId: string,
  preferences: AgentPricingPreferences,
): Promise<void> {
  const value = JSON.stringify(preferences)
  await db
    .insert(schema.prefs)
    .values({ userId, key: agentPricingPreferenceKey, value })
    .onConflictDoUpdate({
      target: [schema.prefs.userId, schema.prefs.key],
      set: { value },
    })
}
