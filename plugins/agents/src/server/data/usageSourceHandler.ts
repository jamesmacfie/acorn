import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm'
import {
  createDataSourceHandler,
  DATA_READ_LIMIT,
  pageDataRecords,
  sqlDataFilters,
  withinDataBudget,
  type CoreServices,
  type PluginDatabase,
  type PluginFetchHandler,
} from '@acorn/plugin-api/node'
import type { AgentUsage } from '../../contract/wire'
import * as schema from '../../node/schema'
import { usageSourceDescription } from '../../shared/usageSource'
import { readAgentPricingPreferences } from '../pricingStore'
import { scopeTasks } from './scopeTasks'
import { modelAtTurn, usageRecords, type UsageEventInput } from './usageRecords'

// A record counts from its session's earlier reports, and its model and turn can change within a
// session, so SQL narrows only by the window and the fields a whole session shares.
const fields = {
  time: { pointer: '/at', column: schema.agentEvents.createdAt },
  equals: {
    '/sessionId': schema.agentEvents.sessionId,
    '/taskId': schema.agentSessions.taskId,
    '/provider': schema.agentSessions.providerId,
  },
}

type UsageRow = Omit<UsageEventInput, 'model' | 'usage'> & { seq: number; eventJson: string; policy: string | null }

const usageEvent = (row: UsageRow): UsageEventInput[] => {
  try {
    const parsed = JSON.parse(row.eventJson) as { type: string; usage?: AgentUsage }
    if (parsed.type !== 'usage' || !parsed.usage) return []
    const { id, sessionId, turnId, taskId, provider, at } = row
    return [{ id, sessionId, turnId, taskId, provider, at, model: modelAtTurn(row.policy), usage: parsed.usage }]
  } catch {
    return []
  }
}

// The WHERE of each partial index in `schema.ts`, repeated exactly so SQLite reads through it.
const usageRow = sql<string>`${schema.agentEvents.eventJson} ->> '$.type' = 'usage'`
const countsFromHere = sql<string>`(${schema.agentEvents.eventJson} ->> '$.usage.inputTokens' IS NOT NULL OR ${schema.agentEvents.eventJson} ->> '$.usage.cost' IS NOT NULL)`

export const usageEvents = (db: PluginDatabase, where: SQL | undefined) =>
  db
    .select({
      id: schema.agentEvents.id,
      sessionId: schema.agentEvents.sessionId,
      turnId: schema.agentEvents.turnId,
      seq: schema.agentEvents.seq,
      at: schema.agentEvents.createdAt,
      eventJson: schema.agentEvents.eventJson,
      taskId: schema.agentSessions.taskId,
      provider: schema.agentSessions.providerId,
      policy: schema.agentTurns.effectivePolicyJson,
    })
    .from(schema.agentEvents)
    .innerJoin(schema.agentSessions, eq(schema.agentEvents.sessionId, schema.agentSessions.id))
    .leftJoin(schema.agentTurns, eq(schema.agentEvents.turnId, schema.agentTurns.id))
    .where(and(usageRow, where))

/** The session's latest usage report before `seq` that counts toward a delta. */
export const usageBaseline = (db: PluginDatabase, sessionId: string, seq: number) =>
  usageEvents(db, and(eq(schema.agentEvents.sessionId, sessionId), lt(schema.agentEvents.seq, seq), countsFromHere))
    .orderBy(desc(schema.agentEvents.seq))
    .limit(1)

export function createUsageSourceHandler(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects' | 'prefs'>,
): PluginFetchHandler {
  return createDataSourceHandler({
    description: usageSourceDescription,
    failure: 'agent_usage_source_failed',
    query: async (input, context) => {
      const tasks = await scopeTasks(core, input.query.scope)
      const { time, equals } = sqlDataFilters(input.query.predicate, fields)
      const read = withinDataBudget(
        await usageEvents(
          db,
          and(...time, ...equals, tasks ? inArray(schema.agentSessions.taskId, [...tasks.keys()]) : undefined),
        )
          .orderBy(desc(schema.agentEvents.createdAt), desc(schema.agentEvents.sessionId), desc(schema.agentEvents.seq))
          .limit(DATA_READ_LIMIT),
      )
      // Each session's report just before the first one kept, which that one's deltas count from.
      const firstSeq = new Map<string, number>()
      for (const row of read.rows)
        firstSeq.set(row.sessionId, Math.min(row.seq, firstSeq.get(row.sessionId) ?? row.seq))
      const baselines: UsageRow[] = []
      for (const [sessionId, seq] of firstSeq) baselines.push(...(await usageBaseline(db, sessionId, seq)))
      const kept = new Set(read.rows.map((row) => row.id))
      const preferences = await readAgentPricingPreferences(core.prefs, context.userId)
      const records = usageRecords([...baselines, ...[...read.rows].reverse()].flatMap(usageEvent), preferences)
        .filter((record) => kept.has(record.recordId))
        .reverse()
      return pageDataRecords(input, { records, truncated: read.truncated }, { timePointer: '/at', readOrder: true })
    },
  })
}
