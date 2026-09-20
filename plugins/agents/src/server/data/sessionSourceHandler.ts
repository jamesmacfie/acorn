import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { compareDataValues } from '@acorn/protocol/dataBindings.ts'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'
import { MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { sessionSourceDescription } from '../../shared/sessionSource'

export function createSessionSourceHandler(runtime: ManagedAgentRuntime): PluginFetchHandler {
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (context.principal.kind !== 'device' && !(context.principal.kind === 'internal' && context.principal.scope === 'service')) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(sessionSourceDescription)
      if (input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const page = await runtime.store.listSessions({
        archived: false,
        ...(input.query.scope.workspaceId ? { workspaceId: input.query.scope.workspaceId } : {}),
        limit: 500,
      })
      let records = page.sessions.map(session => ({
        recordId: session.id,
        data: {
          title: session.title || session.providerId, state: session.runtimeState, attention: session.attention,
          provider: session.providerId, model: session.model ?? null, taskId: session.taskId,
          createdAt: session.createdAt, updatedAt: session.updatedAt,
        },
        display: { title: session.title || session.providerId }, taskId: session.taskId,
        action: { verb: 'openPane' as const, pane: 'agent' },
      }))
      const comparisons = input.query.predicate
        ? input.query.predicate.kind === 'all' ? input.query.predicate.predicates : [input.query.predicate]
        : []
      records = records.filter(record => comparisons.every(predicate => {
        if (predicate.kind !== 'comparison' || predicate.left.address.from !== 'item'
          || (predicate.right && predicate.right.address.from !== 'literal')) throw new Error('unsupported_predicate')
        return compareDataValues(
          readDataPointer(record.data, predicate.left.address.pointer), predicate.operator,
          predicate.right?.address.from === 'literal' ? predicate.right.address.value : MISSING,
        )
      }))
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
      return Response.json({
        records: selected, revision: sessionSourceDescription.revision, readTime: input.evaluationTime,
        completeness: more ? { kind: 'more', cursor: String(offset + selected.length) }
          : input.query.take && records.length >= input.query.take ? { kind: 'bounded' } : { kind: 'complete' },
      })
    } catch {
      return Response.json({ error: 'agent_session_source_failed' }, { status: 502 })
    }
  }
}
