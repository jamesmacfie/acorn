import { eq } from 'drizzle-orm'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import type { Env } from '../bindings'
import { getDb, schema } from '../db'
import { createDataSelectionPager, selectDataRecords } from './selection'
import { registerCoreDataSource } from './registry'
import type { WorktreeCounts } from './localGitRead'

export const CORE_TASK_SOURCE_ID = 'tasks'

// Starter panels for the Add panel launcher (docs/data-sources.md). Their scope names no workspace or
// account: the launcher moves each one onto the scope the person picked.
const taskSource: PanelPlan['sources'][number] = { id: 'tasks', label: 'Workspace tasks', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
  name: 'Workspace tasks', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
  query: { source: { pluginId: 'core', sourceId: CORE_TASK_SOURCE_ID }, scope: { parameters: {} }, sort: [] },
} } }
const taskColumn = (id: string, label: string, type: PanelPlan['columns'][number]['type']): PanelPlan['columns'][number] =>
  ({ id, label, type, bind: { tasks: { field: `/${id}` } } })
const taskStarter = (title: string, columns: PanelPlan['columns'], where: PanelPlan['stages'][number]): PanelPlan => ({
  version: 2, title, time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' }, sources: [taskSource],
  columns: [taskColumn('title', 'Task', 'text'), taskColumn('status', 'Status', 'enum'), ...columns, taskColumn('updatedAt', 'Updated', 'datetime')],
  stages: [where], sort: [{ column: 'updatedAt', direction: 'desc' }], view: { kind: 'list' },
})
export const coreTaskStarterPlans: PanelPlan[] = [
  taskStarter('Tasks updated this week', [], { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/updatedAt' } },
    operator: 'gt', right: { address: { from: 'context', name: 'calendar', boundary: 'startOfWeek' } } } }),
  taskStarter('Tasks with uncommitted changes', [taskColumn('worktreeChanged', 'Uncommitted changes', 'boolean'),
    taskColumn('modifiedCount', 'Modified files', 'number'), taskColumn('untrackedCount', 'Untracked files', 'number')],
  { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/worktreeChanged' } }, operator: 'eq', right: { address: { from: 'literal', value: true } } } }),
]

export const coreTaskSourceDescription: DataSourceDescription = {
  revision: '2',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' }, projectId: { type: 'string' }, project: { type: 'string' },
      workspaceId: { type: 'string' }, workspace: { type: 'string' }, origin: { type: 'string' },
      branch: { type: ['string', 'null'] }, status: { type: 'string' }, worktreeChanged: { type: ['boolean', 'null'] },
      worktreePath: { type: ['string', 'null'] }, modifiedCount: { type: ['number', 'null'] }, untrackedCount: { type: ['number', 'null'] },
      createdAt: { type: 'number' }, updatedAt: { type: 'number' },
    },
    required: ['title', 'projectId', 'project', 'workspaceId', 'workspace', 'origin', 'branch', 'status', 'worktreeChanged', 'worktreePath', 'modifiedCount', 'untrackedCount', 'createdAt', 'updatedAt'],
  },
  fields: [
    { pointer: '/title', label: 'Task', origin: 'declared', display: { kind: 'text', role: 'title' }, query: { operators: ['eq', 'ne', 'contains'], sortable: false } },
    { pointer: '/project', label: 'Project', origin: 'declared', query: { operators: ['eq', 'ne'], sortable: false } },
    { pointer: '/workspace', label: 'Workspace', origin: 'declared', query: { operators: ['eq', 'ne'], sortable: false } },
    { pointer: '/origin', label: 'Origin', origin: 'declared', query: { operators: ['eq', 'ne'], sortable: false } },
    { pointer: '/branch', label: 'Branch', origin: 'declared', query: { operators: ['eq', 'ne', 'missing', 'present'], sortable: false } },
    { pointer: '/status', label: 'Status', origin: 'declared', display: { kind: 'status', role: 'status' }, query: { operators: ['eq', 'ne'], sortable: false }, choices: { kind: 'static', values: [
      { id: 'active', label: 'Active' }, { id: 'archived', label: 'Archived' }, { id: 'cancelled', label: 'Cancelled' },
    ] } },
    { pointer: '/worktreeChanged', label: 'Uncommitted changes', description: 'Null when the Node has not inspected the worktree.', origin: 'declared', display: { kind: 'boolean' } },
    { pointer: '/worktreePath', label: 'Worktree path', origin: 'declared' },
    { pointer: '/modifiedCount', label: 'Modified files', origin: 'declared', display: { kind: 'number' } },
    { pointer: '/untrackedCount', label: 'Untracked files', origin: 'declared', display: { kind: 'number' } },
    { pointer: '/createdAt', label: 'Created', origin: 'declared', display: { kind: 'datetime' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
    { pointer: '/updatedAt', label: 'Updated', origin: 'declared', display: { kind: 'datetime', role: 'updated' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  targets: [{ kind: 'core.task' }],
  starterPlans: coreTaskStarterPlans,
  consistency: 'Task metadata is read from core storage; worktree counts are observed from local Git and remain null if the worktree is unavailable.',
}

const page = createDataSelectionPager()

async function coreTasks(request: DataSourceRequest, env: Env) {
  if (request.operation === 'describe') return coreTaskSourceDescription
  if (request.operation !== 'query') throw new Error('unsupported_operation')
  return page(env.ACTIVE_IDENTITY.get() ?? '', request, async () => {
    const db = getDb(env)
    const tasks = request.query.scope.workspaceId
      ? await db.select({ task: schema.tasks, project: schema.projects, workspace: schema.workspaces })
        .from(schema.tasks).innerJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
        .innerJoin(schema.workspaces, eq(schema.projects.workspaceId, schema.workspaces.id))
        .where(eq(schema.workspaces.id, request.query.scope.workspaceId))
      : await db.select({ task: schema.tasks, project: schema.projects, workspace: schema.workspaces })
        .from(schema.tasks).innerJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
        .innerJoin(schema.workspaces, eq(schema.projects.workspaceId, schema.workspaces.id))
    const visible = tasks.filter(({ project }) => !project.hidden)
    const counts = new Map<string, WorktreeCounts | null>()
    const { worktreeCounts } = await import('./localGitRead')
    for (let index = 0; index < visible.length; index += 4) {
      await Promise.all(visible.slice(index, index + 4).map(async ({ task }) => {
        if (task.worktreePath) counts.set(task.id, await worktreeCounts(task.worktreePath))
      }))
    }
    const records = visible.map(({ task, project, workspace }) => ({
      recordId: task.id,
      data: {
        title: task.title, projectId: project.id, project: project.name,
        workspaceId: workspace.id, workspace: workspace.name, origin: task.origin,
        branch: task.branch, status: task.status, worktreeChanged: counts.get(task.id)?.changed ?? null,
        worktreePath: task.worktreePath, modifiedCount: counts.get(task.id)?.modifiedCount ?? null,
        untrackedCount: counts.get(task.id)?.untrackedCount ?? null,
        createdAt: task.createdAt, updatedAt: task.updatedAt,
      },
      display: { title: task.title }, taskId: task.id, action: { verb: 'openTask' as const }, target: { kind: 'core.task', item: task.id },
    }))
    const selected = selectDataRecords(records, request.query)
    return { ...selected, revision: coreTaskSourceDescription.revision, readTime: request.evaluationTime }
  })
}

registerCoreDataSource({
  sourceId: CORE_TASK_SOURCE_ID,
  name: 'Workspace tasks', singular: 'Task', plural: 'Tasks',
  identityScope: 'Core task UUID; stable for the lifetime of the task',
  titlePointer: '/title', icon: 'circle-check',
}, coreTasks)
