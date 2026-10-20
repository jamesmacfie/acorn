import { eq, gt, gte, lt, lte, type SQL, type SQLWrapper } from 'drizzle-orm'
import type { CoreServices, PluginFetchHandler } from '@acorn/plugin-api/node'
import { compareDataValues, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import {
  dataSourceRequestSchema,
  type DataSourceDescription,
  type DataSourceRequest,
} from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'

// The read every agents data source shares (docs/data-sources.md). The scope and the comparisons SQL
// can answer narrow the read, which runs newest first up to the host's record budget. The whole query
// then runs in memory over what was read, so SQL only ever narrows.

export type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>
type OptionsInput = Extract<DataSourceRequest, { operation: 'options' }>
type SourceRecord = { recordId: string; data: DataValue }
type Scope = { workspaceId?: string; projectId?: string }

export type ScopedTask = { title: string; status: string; projectId: string; projectName: string }

/** Every task of these projects, archived and cancelled ones included, by id. */
async function projectTasks(
  core: Pick<CoreServices, 'tasks'>,
  projects: readonly { id: string; name: string }[],
): Promise<Map<string, ScopedTask>> {
  const tasks = new Map<string, ScopedTask>()
  for (const project of projects)
    for (const task of await core.tasks.inProject(project.id))
      tasks.set(task.id, { title: task.title, status: task.status, projectId: project.id, projectName: project.name })
  return tasks
}

/**
 * The tasks a scope reaches, or null when it names neither a workspace nor a project. Only device and
 * service principals call these sources, so a whole-Node read is the person's own view of their Node.
 */
export async function scopeTasks(
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  scope: Scope,
): Promise<Map<string, ScopedTask> | null> {
  if (!scope.workspaceId && !scope.projectId) return null
  const projects = scope.workspaceId
    ? (await core.projects.byWorkspace(scope.workspaceId)).filter(
        (project) => !scope.projectId || project.id === scope.projectId,
      )
    : [await core.projects.byId(scope.projectId!)].filter((project) => project !== null)
  return projectTasks(core, projects)
}

/** The scope's tasks, or for a whole-Node read, the tasks of the projects these rows name. */
export async function tasksOfRows(
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  scoped: Map<string, ScopedTask> | null,
  projectIds: readonly (string | null)[],
): Promise<Map<string, ScopedTask>> {
  if (scoped) return scoped
  const projects = []
  for (const id of new Set(projectIds)) {
    const project = id ? await core.projects.byId(id) : null
    if (project) projects.push(project)
  }
  return projectTasks(core, projects)
}

/** The columns SQL compares, by field pointer: the time field with `gt`, `gte`, `lt`, and `lte`, and the
 *  `equals` fields with `eq` on a string or a boolean. */
export type SqlFields = { time: { pointer: string; column: SQLWrapper }; equals: Record<string, SQLWrapper> }

const TIME_OPERATORS = { gt, gte, lt, lte }

/** The comparisons SQL can answer, apart from any inside an `any` group. `time` is apart so a source
 *  whose time field is an aggregate can put it in `having`. */
export function sqlFilters(predicate: DataPredicate | undefined, fields: SqlFields): { time: SQL[]; equals: SQL[] } {
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

/** One past the host's record budget, so a read that fills it can tell whether more rows remain. */
export const READ_LIMIT = DATA_LIMITS.selectionRecords + 1

/** The rows a read kept, newest first, and whether the budget left rows of the window unread. */
export const withinBudget = <T>(rows: T[]) => ({
  rows: rows.slice(0, DATA_LIMITS.selectionRecords),
  truncated: rows.length > DATA_LIMITS.selectionRecords,
})

function matches(data: DataValue, predicate: DataPredicate): boolean {
  if (predicate.kind !== 'comparison')
    return predicate.kind === 'all'
      ? predicate.predicates.every((part) => matches(data, part))
      : predicate.predicates.some((part) => matches(data, part))
  if (predicate.left.address.from !== 'item' || (predicate.right && predicate.right.address.from !== 'literal'))
    throw new Error('unsupported_predicate')
  return compareDataValues(
    readDataPointer(data, predicate.left.address.pointer),
    predicate.operator,
    predicate.right?.address.from === 'literal' ? predicate.right.address.value : MISSING,
  )
}

/**
 * Filters, sorts, and pages records read newest first. Sorting is stable, so ties keep that order. A
 * read the budget cut is `incomplete` on its last page, because the host stops paging at the first
 * page that isn't `more`. Its covered range starts at the oldest record it kept.
 */
export function sourcePage<T extends SourceRecord>(
  input: QueryInput,
  read: { records: T[]; truncated: boolean },
  timePointer: string,
) {
  const { predicate, sort, take } = input.query
  let records = predicate ? read.records.filter((record) => matches(record.data, predicate)) : [...read.records]
  records.sort((left, right) => {
    for (const order of sort) {
      const a = readDataPointer(left.data, order.pointer)
      const b = readDataPointer(right.data, order.pointer)
      if (a === b) continue
      if (typeof a !== 'number' || typeof b !== 'number') throw new Error('unsupported_sort')
      return (a - b) * (order.direction === 'asc' ? 1 : -1)
    }
    return 0
  })
  if (take) records = records.slice(0, take)
  const offset = input.cursor ? Number(input.cursor) : 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(records.length, 1))
    throw new Error('invalid_cursor')
  const selected = records.slice(offset, offset + input.pageSize)
  const more = offset + selected.length < records.length
  const oldest = read.records.at(-1)
  return {
    records: selected,
    completeness: more
      ? { kind: 'more' as const, cursor: String(offset + selected.length) }
      : read.truncated
        ? { kind: 'incomplete' as const, cause: 'host-budget' as const }
        : take && records.length >= take
          ? { kind: 'bounded' as const }
          : { kind: 'complete' as const },
    ...(read.truncated && oldest
      ? { coveredRange: { start: readDataPointer(oldest.data, timePointer) as number, end: Date.now() } }
      : {}),
  }
}

/** A data source's route: the principal check, `describe`, and the answer's envelope, around the
 *  source's own read. `coverageComplete` fills in a description whose history may still be filling. */
export function sourceHandler(source: {
  description: DataSourceDescription
  coverageComplete?: () => boolean
  failure: string
  query(input: QueryInput, context: Parameters<PluginFetchHandler>[1]): Promise<object>
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
      const page = await source.query(input, context)
      return Response.json({ ...page, revision: description.revision, readTime: Date.now() })
    } catch {
      return Response.json({ error: source.failure }, { status: 502 })
    }
  }
}
