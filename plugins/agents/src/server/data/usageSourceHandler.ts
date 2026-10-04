import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { CoreServices, PluginDatabase, PluginFetchHandler } from '@acorn/plugin-api/node'
import { compareDataValues, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'
import type { AgentUsage } from '../../contract/wire'
import * as schema from '../../node/schema'
import { usageSourceDescription } from '../../shared/usageSource'
import { readAgentPricingPreferences } from '../pricingStore'
import { usageRecords, type UsageEventInput } from './usageRecords'

const modelAtTurn = (raw: string | null): string | null => {
  if (!raw) return null
  try {
    const policy = JSON.parse(raw) as { model?: unknown; providerAdvertisedPolicy?: unknown }
    if (typeof policy.model === 'string' && policy.model) return policy.model
    if (Array.isArray(policy.providerAdvertisedPolicy)) {
      for (const candidate of policy.providerAdvertisedPolicy) {
        if (candidate && typeof candidate === 'object' && candidate.category === 'model' && typeof candidate.value === 'string') return candidate.value
      }
    }
  } catch { /* The historical turn has no usable model declaration. */ }
  return null
}

function matches(record: ReturnType<typeof usageRecords>[number], predicate: DataPredicate): boolean {
  if (predicate.kind !== 'comparison') return predicate.kind === 'all'
    ? predicate.predicates.every(item => matches(record, item)) : predicate.predicates.some(item => matches(record, item))
  if (predicate.left.address.from !== 'item' || predicate.right?.address.from !== 'literal') throw new Error('unsupported_predicate')
  return compareDataValues(readDataPointer(record.data, predicate.left.address.pointer), predicate.operator,
    predicate.right?.address.from === 'literal' ? predicate.right.address.value : MISSING)
}

export function createUsageSourceHandler(db: PluginDatabase, core: Pick<CoreServices, 'tasks' | 'prefs'>): PluginFetchHandler {
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (context.principal.kind !== 'device' && !(context.principal.kind === 'internal' && context.principal.scope === 'service')) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(usageSourceDescription)
      if (input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const allowedIds = input.query.scope.workspaceId ? await core.tasks.idsForWorkspace(input.query.scope.workspaceId) : null
      const projectId = input.query.scope.projectId
      const projectIds = projectId && allowedIds ? (await Promise.all(allowedIds.map(async id => ({ id, task: await core.tasks.load(id) }))))
        .filter(item => item.task?.projectId === projectId).map(item => item.id) : allowedIds
      if (projectIds?.length === 0) return Response.json({ records: [], revision: usageSourceDescription.revision,
        readTime: Date.now(), completeness: { kind: 'complete' }, coveredRange: { start: Date.now(), end: Date.now() } })
      const rows = await db.select({
        id: schema.agentEvents.id, sessionId: schema.agentEvents.sessionId, turnId: schema.agentEvents.turnId,
        at: schema.agentEvents.createdAt, eventJson: schema.agentEvents.eventJson,
        taskId: schema.agentSessions.taskId, provider: schema.agentSessions.providerId,
        policy: schema.agentTurns.effectivePolicyJson,
      }).from(schema.agentEvents)
        .innerJoin(schema.agentSessions, eq(schema.agentEvents.sessionId, schema.agentSessions.id))
        .leftJoin(schema.agentTurns, eq(schema.agentEvents.turnId, schema.agentTurns.id))
        .where(and(eq(sql<string>`json_extract(${schema.agentEvents.eventJson}, '$.type')`, 'usage'),
          projectIds ? inArray(schema.agentSessions.taskId, projectIds) : undefined))
        .orderBy(asc(schema.agentEvents.createdAt), asc(schema.agentEvents.sessionId), asc(schema.agentEvents.seq))
        .limit(DATA_LIMITS.selectionRecords + 1)
      const truncated = rows.length > DATA_LIMITS.selectionRecords
      const events: UsageEventInput[] = rows.slice(0, DATA_LIMITS.selectionRecords).flatMap(row => {
        try {
          const parsed = JSON.parse(row.eventJson) as { type: string; usage?: AgentUsage }
          return parsed.type === 'usage' && parsed.usage ? [{ id: row.id, sessionId: row.sessionId, turnId: row.turnId,
            taskId: row.taskId, provider: row.provider, model: modelAtTurn(row.policy), at: row.at, usage: parsed.usage }] : []
        } catch { return [] }
      })
      const preferences = await readAgentPricingPreferences(core.prefs, context.userId)
      let records = usageRecords(events, preferences)
      if (input.query.predicate) records = records.filter(record => matches(record, input.query.predicate!))
      records.sort((left, right) => {
        for (const sort of input.query.sort) {
          const a = readDataPointer(left.data, sort.pointer)
          const b = readDataPointer(right.data, sort.pointer)
          if (a === b) continue
          if (typeof a !== 'number' || typeof b !== 'number') throw new Error('unsupported_sort')
          return (a - b) * (sort.direction === 'asc' ? 1 : -1)
        }
        return left.recordId.localeCompare(right.recordId)
      })
      if (input.query.take) records = records.slice(0, input.query.take)
      const offset = input.cursor ? Number(input.cursor) : 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(records.length, 1)) throw new Error('invalid_cursor')
      const selected = records.slice(offset, offset + input.pageSize)
      const more = offset + selected.length < records.length
      const now = Date.now()
      return Response.json({ records: selected, revision: usageSourceDescription.revision, readTime: now,
        coveredRange: { start: events[0]?.at ?? now, end: now },
        completeness: truncated ? { kind: 'incomplete', cause: 'host-budget' }
          : more ? { kind: 'more', cursor: String(offset + selected.length) }
            : input.query.take && records.length >= input.query.take ? { kind: 'bounded' } : { kind: 'complete' },
      })
    } catch { return Response.json({ error: 'agent_usage_source_failed' }, { status: 502 }) }
  }
}
