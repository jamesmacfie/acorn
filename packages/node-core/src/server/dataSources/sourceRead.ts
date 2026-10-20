import { eq, gt, gte, lt, lte, type SQL, type SQLWrapper } from 'drizzle-orm'
import {
  dataSourceRequestSchema,
  type DataSourceDescription,
  type DataSourceRequest,
} from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { PluginFetchHandler, PluginRequestContext } from '../pluginHost/types'

// A plugin source's route and SQL read. See docs/data-sources/serve-a-query.md. They sit apart from
// `selectDataRecords` and the pagers, which the core sources load at boot, because only plugin sources
// loaded on first use need them.

type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>
type OptionsInput = Extract<DataSourceRequest, { operation: 'options' }>

/** One past the host's record budget, so a read that fills it can tell whether more rows remain. */
export const DATA_READ_LIMIT = DATA_LIMITS.selectionRecords + 1

/** The rows a newest-first read kept, and whether the budget left older rows unread. */
export const withinDataBudget = <T>(rows: T[]) => ({
  rows: rows.slice(0, DATA_LIMITS.selectionRecords),
  truncated: rows.length > DATA_LIMITS.selectionRecords,
})

/** The columns SQL compares, by field pointer: the time field with `gt`, `gte`, `lt`, and `lte`, and the
 *  `equals` fields with `eq` on a string or a boolean. */
type SqlFields = { time: { pointer: string; column: SQLWrapper }; equals: Record<string, SQLWrapper> }

const TIME_OPERATORS = { gt, gte, lt, lte }

/** The comparisons SQL can answer, apart from any inside an `any` group. Select the read with
 *  `pageDataRecords` afterwards, so SQL only narrows. `time` is apart so a source whose time field is an
 *  aggregate can put it in `having`. */
export function sqlDataFilters(
  predicate: DataPredicate | undefined,
  fields: SqlFields,
): { time: SQL[]; equals: SQL[] } {
  const filters = { time: [] as SQL[], equals: [] as SQL[] }
  const visit = (part: DataPredicate): void => {
    if (part.kind === 'all') return part.predicates.forEach(visit)
    if (part.kind !== 'comparison' || part.left.address.from !== 'item' || part.right?.address.from !== 'literal')
      return
    const pointer = part.left.address.pointer
    const value = part.right.address.value
    const column = fields.equals[pointer]
    if (pointer === fields.time.pointer && typeof value === 'number' && Object.hasOwn(TIME_OPERATORS, part.operator))
      filters.time.push(TIME_OPERATORS[part.operator as keyof typeof TIME_OPERATORS](fields.time.column, value))
    else if (part.operator === 'eq' && (typeof value === 'string' || typeof value === 'boolean') && column)
      filters.equals.push(eq(column, value))
  }
  if (predicate) visit(predicate)
  return filters
}

/** A data source's route: the principal check, `describe`, and the answer's envelope, around the
 *  source's own read. `coverageComplete` fills in a description whose history may still be filling. */
export function createDataSourceHandler(source: {
  description: DataSourceDescription
  coverageComplete?: () => boolean
  failure: string
  query(input: QueryInput, context: PluginRequestContext, signal: AbortSignal): Promise<object>
  options?(input: OptionsInput): Promise<object>
}): PluginFetchHandler {
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (
        context.principal.kind !== 'device' &&
        !(context.principal.kind === 'internal' && context.principal.scope === 'service')
      ) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      const input = dataSourceRequestSchema.parse(await request.json())
      const { description, coverageComplete } = source
      if (input.operation === 'describe')
        return Response.json(
          coverageComplete && description.coverage
            ? { ...description, coverage: { ...description.coverage, complete: coverageComplete() } }
            : description,
        )
      if (input.operation === 'options' && source.options) return Response.json(await source.options(input))
      if (input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const page = await source.query(input, context, request.signal)
      return Response.json({ ...page, revision: description.revision, readTime: Date.now() })
    } catch {
      return Response.json({ error: source.failure }, { status: 502 })
    }
  }
}
