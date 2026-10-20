import { and, asc, desc, inArray } from 'drizzle-orm'
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
import { workflowRuns as runs } from '../../node/schema'
import { runSourceDescription } from '../../shared/runSource'
import { TERMINAL_WORKFLOW_STATUSES } from '../../shared/runStatus'

type Core = Pick<CoreServices, 'tasks' | 'projects'>
type RunTask = { title: string; projectId: string; projectName: string | null }
type Scope = { workspaceId?: string; projectId?: string }

// Runs carry only a task id, so SQL narrows by the scope's task ids, which the (task_id, created_at)
// index serves together with the time window. The public `/trigger` field is the `started_by` column,
// so saved queries and panels that filter on it keep working.
const fields = {
  time: { pointer: '/createdAt', column: runs.createdAt },
  equals: {
    '/name': runs.name,
    '/status': runs.status,
    '/trigger': runs.startedBy,
    '/taskId': runs.taskId,
    '/parentRunId': runs.parentRunId,
  },
}
const optionColumns: Record<string, typeof runs.name | typeof runs.startedBy> = {
  '/name': runs.name,
  '/trigger': runs.startedBy,
}

/**
 * Every task a scope reaches, archived and cancelled ones included, by id. Null when the scope names
 * neither a workspace nor a project: only device and service principals call this source, so a
 * whole-Node read is the person's own view of their Node.
 */
async function scopeTasks(core: Core, scope: Scope): Promise<Map<string, RunTask> | null> {
  if (!scope.workspaceId && !scope.projectId) return null
  const projects = scope.workspaceId
    ? (await core.projects.byWorkspace(scope.workspaceId)).filter(
        (project) => !scope.projectId || project.id === scope.projectId,
      )
    : [await core.projects.byId(scope.projectId!)].filter((project) => project !== null)
  const tasks = new Map<string, RunTask>()
  for (const project of projects)
    for (const task of await core.tasks.inProject(project.id))
      tasks.set(task.id, { title: task.title, projectId: project.id, projectName: project.name })
  return tasks
}

/** For a whole-Node read, the tasks these runs ran on, looked up one by one. */
async function tasksById(core: Core, taskIds: readonly string[]): Promise<Map<string, RunTask>> {
  const tasks = new Map<string, RunTask>()
  const projectNames = new Map<string, string | null>()
  for (const id of new Set(taskIds)) {
    const task = await core.tasks.load(id)
    if (!task) continue
    if (!projectNames.has(task.projectId))
      projectNames.set(task.projectId, (await core.projects.byId(task.projectId))?.name ?? null)
    tasks.set(id, { title: task.title, projectId: task.projectId, projectName: projectNames.get(task.projectId)! })
  }
  return tasks
}

/** The error's first line, short enough for a table cell. Stack traces and tool output stay in the run pane. */
const shortError = (error: string | null): string | null => error?.split('\n', 1)[0]!.slice(0, 200) || null

export function createRunSourceHandler(db: PluginDatabase, core: Core): PluginFetchHandler {
  return createDataSourceHandler({
    description: runSourceDescription,
    failure: 'workflow_run_source_failed',
    options: async (input) => {
      const column = optionColumns[input.pointer]
      if (input.target !== 'field' || !column) throw new Error('unsupported_options')
      const scoped = await scopeTasks(core, input.scope)
      const search = input.search.toLowerCase()
      const values = (
        await db
          .selectDistinct({ value: column })
          .from(runs)
          .where(scoped ? inArray(runs.taskId, [...scoped.keys()]) : undefined)
          .orderBy(asc(column))
      ).flatMap(({ value }) => (value.toLowerCase().includes(search) ? [value] : []))
      return {
        options: values.slice(0, input.pageSize).map((value) => ({ id: value, label: value.slice(0, 80) })),
        exhausted: values.length <= input.pageSize,
      }
    },
    query: async (input) => {
      const scoped = await scopeTasks(core, input.query.scope)
      const { time, equals } = sqlDataFilters(input.query.predicate, fields)
      const read = withinDataBudget(
        await db
          .select({
            id: runs.id,
            name: runs.name,
            status: runs.status,
            trigger: runs.startedBy,
            taskId: runs.taskId,
            parentRunId: runs.parentRunId,
            depth: runs.depth,
            error: runs.error,
            createdAt: runs.createdAt,
            updatedAt: runs.updatedAt,
          })
          .from(runs)
          .where(and(...time, ...equals, scoped ? inArray(runs.taskId, [...scoped.keys()]) : undefined))
          .orderBy(desc(runs.createdAt), desc(runs.id))
          .limit(DATA_READ_LIMIT),
      )
      const tasks =
        scoped ??
        (await tasksById(
          core,
          read.rows.map((row) => row.taskId),
        ))
      const records = read.rows.map(({ id, error, ...row }) => {
        const task = tasks.get(row.taskId)
        return {
          recordId: id,
          data: {
            runId: id,
            ...row,
            taskTitle: task?.title ?? null,
            projectId: task?.projectId ?? null,
            projectName: task?.projectName ?? null,
            error: shortError(error),
            durationMs: TERMINAL_WORKFLOW_STATUSES.has(row.status) ? row.updatedAt - row.createdAt : null,
          },
          taskId: row.taskId,
          // The run pane's id, WORKFLOWS_PANE_ID, which lives in the client half.
          action: { verb: 'openPane' as const, pane: 'workflows' },
          target: { kind: 'workflows.run', item: id },
        }
      })
      return pageDataRecords(
        input,
        { records, truncated: read.truncated },
        { timePointer: '/createdAt', readOrder: true },
      )
    },
  })
}
