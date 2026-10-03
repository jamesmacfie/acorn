import { eq } from 'drizzle-orm'
import type { DataSourceDescription, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import type { Env } from '../bindings'
import { getDb, schema } from '../db'
import { createDataSelectionPager, selectDataRecords } from './selection'
import { registerCoreDataSource } from './registry'

export const CORE_TASK_SOURCE_ID = 'tasks'

export const coreTaskSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' }, projectId: { type: 'string' }, project: { type: 'string' },
      workspaceId: { type: 'string' }, workspace: { type: 'string' }, origin: { type: 'string' },
      branch: { type: ['string', 'null'] }, status: { type: 'string' }, worktreeChanged: { type: ['boolean', 'null'] },
      createdAt: { type: 'number' }, updatedAt: { type: 'number' },
    },
    required: ['title', 'projectId', 'project', 'workspaceId', 'workspace', 'origin', 'branch', 'status', 'worktreeChanged', 'createdAt', 'updatedAt'],
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
    { pointer: '/createdAt', label: 'Created', origin: 'declared', display: { kind: 'datetime' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
    { pointer: '/updatedAt', label: 'Updated', origin: 'declared', display: { kind: 'datetime', role: 'updated' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  targets: [{ kind: 'core.task' }],
  consistency: 'A task query is a transactionally consistent read of core task metadata. Worktree change status is optional and remains null when it has not been inspected.',
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
    const records = tasks.filter(({ project }) => !project.hidden).map(({ task, project, workspace }) => ({
      recordId: task.id,
      data: {
        title: task.title, projectId: project.id, project: project.name,
        workspaceId: workspace.id, workspace: workspace.name, origin: task.origin,
        branch: task.branch, status: task.status, worktreeChanged: null,
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
