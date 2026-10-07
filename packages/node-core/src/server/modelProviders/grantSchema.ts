import { eq, lt, sql } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// A loaded plugin's model grant: which backend and model a call that names no backend spends, and how
// many output tokens it may spend per day (docs/integrations/model-providers.md § Plugin model grants).
// Keyed by the Node's owner id and the plugin id. The owner sets it from Settings over a device-only
// route; the plugin can't reach either table.
export const pluginModelGrants = sqliteTable('plugin_model_grants', {
  ownerId: text('owner_id').notNull(),
  pluginId: text('plugin_id').notNull(),
  // `connection:<uuid>` or `harness:<profileId>`.
  backendId: text('backend_id').notNull(),
  // '' means the backend's default.
  modelId: text('model_id').notNull(),
  dailyOutputTokens: integer('daily_output_tokens').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.pluginId] })])

// One row per call a loaded plugin made through its models facet. A granted call is admitted by writing
// its row as `reserved`, and settled afterwards. An explicit-backend call is recorded once it ends and
// never counts against the allowance.
export const pluginModelCalls = sqliteTable('plugin_model_calls', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  pluginId: text('plugin_id').notNull(),
  // The Node-local calendar day at admission, `YYYY-MM-DD`. A call keeps its day across midnight.
  day: text('day').notNull(),
  // 'granted' spends the grant; 'explicit' named its own backend.
  path: text('path').notNull(),
  backendId: text('backend_id').notNull(),
  // reserved | settled | released | interrupted
  status: text('status').notNull(),
  // What admission held: `maxOutputTokens` for a connection, the fixed estimate for an agent CLI.
  reservedUnits: integer('reserved_units').notNull(),
  // What the call cost the allowance once it ended. Null while reserved.
  chargedUnits: integer('charged_units'),
  // What the provider reported, kept apart from the charge. A CLI's report never lowers its estimate.
  reportedInputTokens: integer('reported_input_tokens'),
  reportedOutputTokens: integer('reported_output_tokens'),
  createdAt: integer('created_at').notNull(),
  settledAt: integer('settled_at'),
}, (t) => [index('plugin_model_calls_day_idx').on(t.ownerId, t.pluginId, t.day)])

export const MAX_DAILY_OUTPUT_TOKENS = 10_000_000
// Settled rows older than this go at boot. The allowance only reads today's.
const KEEP_CALLS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Boot: no call from an earlier process can still settle, and any of them may have spent, so each open
 * reservation is charged in full. Also drops rows past retention. Here rather than in ./grants.ts so
 * boot doesn't load the grant runtime, which waits for the first plugin call or settings read.
 */
export function chargeInterruptedModelCalls(db: AppDatabase, now = Date.now()): void {
  const calls = pluginModelCalls
  db.update(calls).set({ status: 'interrupted', chargedUnits: sql`${calls.reservedUnits}`, settledAt: now })
    .where(eq(calls.status, 'reserved')).run()
  db.delete(calls).where(lt(calls.createdAt, now - KEEP_CALLS_MS)).run()
}
