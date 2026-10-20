import { and, count, desc, gt, gte, inArray, lt, lte, min, type SQL } from 'drizzle-orm'
import {
  dataComparisons,
  selectDataRecords,
  type CoreServices,
  type PluginDatabase,
  type PluginFetchHandler,
} from '@acorn/plugin-api/node'
import { dataSourceRequestSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { terminalRuns } from '../node/schema'
import { runSourceDescription } from '../shared/runSource'
import { RUN_RECORD_CAP } from './runRecords'

type Core = Pick<CoreServices, 'tasks' | 'projects'>
type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>
type Scope = QueryInput['query']['scope']
type TaskFacts = { title: string; projectName: string | null }

const TIME_OPERATORS = { gt, gte, lt, lte }

/** The tasks a scope reaches, by id, or null when it names neither a workspace nor a project. Only device
 *  and service principals call this source, so a whole-Node read is the person's own view of their Node. */
async function scopeTasks(core: Core, scope: Scope): Promise<Map<string, TaskFacts> | null> {
  if (!scope.workspaceId && !scope.projectId) return null
  const projects = scope.workspaceId
    ? (await core.projects.byWorkspace(scope.workspaceId)).filter(
        (project) => !scope.projectId || project.id === scope.projectId,
      )
    : [await core.projects.byId(scope.projectId!)].filter((project) => project !== null)
  const tasks = new Map<string, TaskFacts>()
  for (const project of projects)
    for (const task of await core.tasks.inProject(project.id))
      tasks.set(task.id, { title: task.title, projectName: project.name })
  return tasks
}

/** For a whole-Node read, the tasks the rows name. */
async function rowTasks(core: Core, taskIds: string[]): Promise<Map<string, TaskFacts>> {
  const tasks = new Map<string, TaskFacts>()
  for (const id of new Set(taskIds)) {
    const task = await core.tasks.load(id)
    const project = task?.projectId ? await core.projects.byId(task.projectId) : null
    if (task) tasks.set(id, { title: task.title, projectName: project?.name ?? null })
  }
  return tasks
}

/** The query's bounds on the finish time, which SQL answers before anything else is read. */
const finishedWindow = (input: QueryInput): SQL[] =>
  dataComparisons(input.query.predicate).flatMap((part) => {
    const value = part.right?.address.from === 'literal' ? part.right.address.value : null
    return part.left.address.from === 'item' &&
      part.left.address.pointer === '/finishedAt' &&
      typeof value === 'number' &&
      Object.hasOwn(TIME_OPERATORS, part.operator)
      ? [TIME_OPERATORS[part.operator as keyof typeof TIME_OPERATORS](terminalRuns.finishedAt, value)]
      : []
  })

const outcome = (exitCode: number | null) => (exitCode === null ? 'killed' : exitCode === 0 ? 'succeeded' : 'failed')

// The table never holds more than the host's record budget (RUN_RECORD_CAP), so a read is never cut short.
// Once the cap has dropped old runs, the history starts at the oldest run kept.
async function runPage(db: PluginDatabase, core: Core, input: QueryInput) {
  const scoped = await scopeTasks(core, input.query.scope)
  const rows = await db
    .select()
    .from(terminalRuns)
    .where(
      and(
        // Runs that finish while a run pages through the table don't shift its pages.
        lte(terminalRuns.finishedAt, input.evaluationTime),
        ...finishedWindow(input),
        scoped ? inArray(terminalRuns.taskId, [...scoped.keys()]) : undefined,
      ),
    )
    .orderBy(desc(terminalRuns.finishedAt), desc(terminalRuns.id))
  const tasks =
    scoped ??
    (await rowTasks(
      core,
      rows.map((row) => row.taskId),
    ))
  const records = rows.map((row) => {
    const task = tasks.get(row.taskId)
    return {
      recordId: row.id,
      taskId: row.taskId,
      data: {
        name: row.name,
        kind: row.kind,
        outcome: outcome(row.exitCode),
        exitCode: row.exitCode,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        durationMs: row.finishedAt - row.startedAt,
        taskId: row.taskId,
        taskTitle: task?.title ?? null,
        projectName: task?.projectName ?? null,
      },
    }
  })
  const selected = selectDataRecords(records, input.query)
  const offset = input.cursor ? Number(input.cursor) : 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(selected.records.length, 1))
    throw new Error('invalid_cursor')
  const page = selected.records.slice(offset, offset + input.pageSize)
  const next = offset + page.length
  const [kept] = await db.select({ rows: count(), oldest: min(terminalRuns.finishedAt) }).from(terminalRuns)
  return {
    records: page,
    completeness:
      next < selected.records.length ? { kind: 'more' as const, cursor: String(next) } : selected.completeness,
    ...(kept!.rows >= RUN_RECORD_CAP && kept!.oldest !== null
      ? { coveredRange: { start: kept!.oldest, end: input.evaluationTime } }
      : {}),
    revision: runSourceDescription.revision,
    readTime: Date.now(),
  }
}

export function createRunSourceHandler(db: PluginDatabase, core: Core): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    if (
      context.principal.kind !== 'device' &&
      !(context.principal.kind === 'internal' && context.principal.scope === 'service')
    )
      return Response.json({ error: 'forbidden' }, { status: 403 })
    try {
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(runSourceDescription)
      if (input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      return Response.json(await runPage(db, core, input))
    } catch {
      return Response.json({ error: 'terminal_run_source_failed' }, { status: 502 })
    }
  }
}
