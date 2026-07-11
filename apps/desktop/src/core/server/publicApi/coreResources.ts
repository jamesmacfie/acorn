import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { PublicApiError } from '../../shared/publicApi/errors'
import { IdSchema, OwnerSchema, PageSchema, RepoNameSchema } from '../../shared/publicApi/primitives'
import {
  ArchiveTaskSchema,
  CreateTaskSchema,
  CreateWorkspaceSchema,
  PatchRepositoryAssignmentSchema,
  PatchTaskSchema,
  PatchWorkspaceSchema,
  PinnedRepoSchema,
  PutRepositoryAssignmentSchema,
  ReplacePinnedReposSchema,
  ReplaceWorkspaceProjectsSchema,
  RepositoryAssignmentQuerySchema,
  RepositoryAssignmentSchema,
  TaskLinkInputSchema,
  TaskLinkSchema,
  TaskListQuerySchema,
  TaskSchema,
  TaskStatusSchema,
  WorkspaceProjectsResponseSchema,
  WorkspaceSchema,
} from '../../shared/publicApi/resources'
import { NO_CONTENT, defineEndpoint, defineEvent, type EventContribution, type PluginApiContribution } from './defineEndpoint'
import type { TaskService } from './services/taskService'
import type { WorkspaceService } from './services/workspaceService'

// Required core event channels (docs/public-api.md). Payloads are the resource shapes or a
// `{ id }` for deletions; kept as z.unknown() at the channel declaration (the endpoint publishes the
// concrete object).
const CORE_EVENTS: EventContribution[] = [
  'core.workspace.created',
  'core.workspace.updated',
  'core.workspace.deleted',
  'core.repository-assignment.updated',
  'core.task.created',
  'core.task.updated',
  'core.task.archived',
  'core.task.restored',
].map((channel) => defineEvent({ pluginId: 'core', channel, description: channel, schema: z.unknown(), scope: 'read' }))

// Core resource endpoints (docs/public-api.md). Thin adapters over WorkspaceService /
// TaskService; pinned repos are mapped owner/name ↔ GitHub repo id via the mirror.
//
// ponytail: list endpoints return the full bounded set with nextCursor:null. Opaque cursor
// pagination is a later refinement — the collections here are machine-local and small.

export type CoreResourceDeps = {
  db: AppDatabase
  workspaces: WorkspaceService
  tasks: TaskService
}

const CORE = 'core'
const WorkspaceParams = z.strictObject({ workspaceId: IdSchema })
const TaskParams = z.strictObject({ taskId: IdSchema })
const RepoParams = z.strictObject({ owner: OwnerSchema, repo: RepoNameSchema })

export function buildCoreResourceContribution(deps: CoreResourceDeps): PluginApiContribution {
  const { db, workspaces, tasks } = deps
  return {
    pluginId: CORE,
    events: CORE_EVENTS,
    endpoints: [
      // ---- Workspaces ----
      defineEndpoint({
        operationId: 'core.workspace.list',
        pluginId: CORE,
        method: 'GET',
        path: '/workspaces',
        scope: 'read',
        risk: 'read',
        summary: 'List workspaces',
        response: PageSchema(WorkspaceSchema),
        handler: async () => ({ items: await workspaces.list(), nextCursor: null }),
      }),
      defineEndpoint({
        operationId: 'core.workspace.create',
        pluginId: CORE,
        method: 'POST',
        path: '/workspaces',
        scope: 'write',
        risk: 'write',
        summary: 'Create a workspace',
        body: CreateWorkspaceSchema,
        response: WorkspaceSchema,
        status: 201,
        handler: async (ctx, { body }) => {
          const ws = await workspaces.create(body)
          ctx.publish.publish({ channel: 'core.workspace.created', data: ws, resource: { type: 'workspace', id: ws.id }, workspaceId: ws.id })
          return ws
        },
      }),
      defineEndpoint({
        operationId: 'core.workspace.bootstrap',
        pluginId: CORE,
        method: 'POST',
        path: '/workspaces/bootstrap',
        scope: 'write',
        risk: 'write',
        summary: 'Idempotent first-run workspace setup',
        body: z.undefined(),
        response: PageSchema(WorkspaceSchema),
        handler: async (ctx) => ({ items: await workspaces.bootstrap(ctx.actor.principalId), nextCursor: null }),
      }),
      defineEndpoint({
        operationId: 'core.workspace.get',
        pluginId: CORE,
        method: 'GET',
        path: '/workspaces/:workspaceId',
        scope: 'read',
        risk: 'read',
        summary: 'Get a workspace',
        params: WorkspaceParams,
        response: WorkspaceSchema,
        handler: async (_ctx, { params }) => workspaces.getOrThrow(params.workspaceId),
      }),
      defineEndpoint({
        operationId: 'core.workspace.patch',
        pluginId: CORE,
        method: 'PATCH',
        path: '/workspaces/:workspaceId',
        scope: 'write',
        risk: 'write',
        summary: 'Update a workspace',
        params: WorkspaceParams,
        body: PatchWorkspaceSchema,
        response: WorkspaceSchema,
        handler: async (_ctx, { params, body }) => workspaces.update(params.workspaceId, body),
      }),
      defineEndpoint({
        operationId: 'core.workspace.delete',
        pluginId: CORE,
        method: 'DELETE',
        path: '/workspaces/:workspaceId',
        scope: 'write',
        risk: 'write',
        summary: 'Delete a workspace; repos return to Default',
        params: WorkspaceParams,
        response: z.undefined(),
        status: 204,
        handler: async (_ctx, { params }) => {
          await workspaces.delete(params.workspaceId)
          return NO_CONTENT
        },
      }),
      defineEndpoint({
        operationId: 'core.workspace.projects.get',
        pluginId: CORE,
        method: 'GET',
        path: '/workspaces/:workspaceId/projects',
        scope: 'read',
        risk: 'read',
        summary: 'Linked external projects',
        params: WorkspaceParams,
        response: WorkspaceProjectsResponseSchema,
        handler: async (_ctx, { params }) => ({ projects: await workspaces.getProjects(params.workspaceId) }),
      }),
      defineEndpoint({
        operationId: 'core.workspace.projects.replace',
        pluginId: CORE,
        method: 'PUT',
        path: '/workspaces/:workspaceId/projects',
        scope: 'write',
        risk: 'write',
        summary: 'Replace the linked external project set',
        params: WorkspaceParams,
        body: ReplaceWorkspaceProjectsSchema,
        response: WorkspaceProjectsResponseSchema,
        handler: async (ctx, { params, body }) => ({
          projects: await workspaces.replaceProjects(params.workspaceId, ctx.actor.principalId, body.projects),
        }),
      }),

      // ---- Repository assignments ----
      defineEndpoint({
        operationId: 'core.repository-assignment.list',
        pluginId: CORE,
        method: 'GET',
        path: '/repository-assignments',
        scope: 'read',
        risk: 'read',
        summary: 'List repository assignments',
        query: RepositoryAssignmentQuerySchema,
        response: PageSchema(RepositoryAssignmentSchema),
        handler: async (_ctx, { query }) => ({
          items: await workspaces.listAssignments({
            workspaceId: query.workspaceId,
            ignored: query.ignored === undefined ? undefined : query.ignored === 'true',
          }),
          nextCursor: null,
        }),
      }),
      defineEndpoint({
        operationId: 'core.repository-assignment.put',
        pluginId: CORE,
        method: 'PUT',
        path: '/repository-assignments/:owner/:repo',
        scope: 'write',
        risk: 'write',
        summary: 'Assign a repository to a workspace',
        params: RepoParams,
        body: PutRepositoryAssignmentSchema,
        response: RepositoryAssignmentSchema,
        handler: async (_ctx, { params, body }) => workspaces.putAssignment(params.owner, params.repo, body),
      }),
      defineEndpoint({
        operationId: 'core.repository-assignment.patch',
        pluginId: CORE,
        method: 'PATCH',
        path: '/repository-assignments/:owner/:repo',
        scope: 'write',
        risk: 'write',
        summary: 'Update a repository assignment',
        params: RepoParams,
        body: PatchRepositoryAssignmentSchema,
        response: RepositoryAssignmentSchema,
        handler: async (_ctx, { params, body }) => workspaces.patchAssignment(params.owner, params.repo, body),
      }),

      // ---- Tasks ----
      defineEndpoint({
        operationId: 'core.task.list',
        pluginId: CORE,
        method: 'GET',
        path: '/tasks',
        scope: 'read',
        risk: 'read',
        summary: 'List tasks',
        query: TaskListQuerySchema,
        response: PageSchema(TaskSchema),
        handler: async (_ctx, { query }) => ({ items: await tasks.list(query), nextCursor: null }),
      }),
      defineEndpoint({
        operationId: 'core.task.create',
        pluginId: CORE,
        method: 'POST',
        path: '/tasks',
        scope: 'write',
        risk: 'write',
        summary: 'Create a task',
        idempotency: 'required',
        body: CreateTaskSchema,
        response: TaskSchema,
        status: 201,
        handler: async (ctx, { body }) => {
          const task = await tasks.create(body, ctx.actor.principalId)
          ctx.publish.publish({ channel: 'core.task.created', data: task, resource: { type: 'task', id: task.id }, taskId: task.id })
          return task
        },
      }),
      defineEndpoint({
        operationId: 'core.task.get',
        pluginId: CORE,
        method: 'GET',
        path: '/tasks/:taskId',
        scope: 'read',
        risk: 'read',
        summary: 'Get a task',
        params: TaskParams,
        response: TaskSchema,
        handler: async (_ctx, { params }) => tasks.getOrThrow(params.taskId),
      }),
      defineEndpoint({
        operationId: 'core.task.patch',
        pluginId: CORE,
        method: 'PATCH',
        path: '/tasks/:taskId',
        scope: 'write',
        risk: 'write',
        summary: 'Update a task title or sort',
        params: TaskParams,
        body: PatchTaskSchema,
        response: TaskSchema,
        handler: async (_ctx, { params, body }) => tasks.patch(params.taskId, body),
      }),
      defineEndpoint({
        operationId: 'core.task.archive',
        pluginId: CORE,
        method: 'POST',
        path: '/tasks/:taskId/archive',
        scope: 'write',
        risk: 'write',
        summary: 'Archive a task',
        params: TaskParams,
        body: ArchiveTaskSchema,
        response: TaskSchema,
        handler: async (ctx, { params, body }) => {
          const task = await tasks.archive(params.taskId, body)
          ctx.publish.publish({ channel: 'core.task.archived', data: task, resource: { type: 'task', id: task.id }, taskId: task.id })
          return task
        },
      }),
      defineEndpoint({
        operationId: 'core.task.restore',
        pluginId: CORE,
        method: 'POST',
        path: '/tasks/:taskId/restore',
        scope: 'write',
        risk: 'write',
        summary: 'Restore an archived task',
        params: TaskParams,
        body: z.undefined(),
        response: TaskSchema,
        handler: async (_ctx, { params }) => tasks.restore(params.taskId),
      }),
      defineEndpoint({
        operationId: 'core.task.status',
        pluginId: CORE,
        method: 'GET',
        path: '/tasks/:taskId/status',
        scope: 'read',
        risk: 'read',
        summary: 'Worktree/dirty/session summary',
        params: TaskParams,
        response: TaskStatusSchema,
        handler: async (_ctx, { params }) => tasks.status(params.taskId),
      }),
      defineEndpoint({
        operationId: 'core.task.links.list',
        pluginId: CORE,
        method: 'GET',
        path: '/tasks/:taskId/links',
        scope: 'read',
        risk: 'read',
        summary: 'List task links',
        params: TaskParams,
        response: z.strictObject({ items: z.array(TaskLinkSchema) }),
        handler: async (_ctx, { params }) => ({ items: await tasks.listLinks(params.taskId) }),
      }),
      defineEndpoint({
        operationId: 'core.task.links.create',
        pluginId: CORE,
        method: 'POST',
        path: '/tasks/:taskId/links',
        scope: 'write',
        risk: 'write',
        summary: 'Add a task link',
        idempotency: 'required',
        params: TaskParams,
        body: TaskLinkInputSchema,
        response: TaskLinkSchema,
        status: 201,
        handler: async (ctx, { params, body }) => tasks.addLink(params.taskId, body, ctx.actor.principalId),
      }),
      defineEndpoint({
        operationId: 'core.task.links.delete',
        pluginId: CORE,
        method: 'DELETE',
        path: '/tasks/:taskId/links/:connectionId/:identifier',
        scope: 'write',
        risk: 'write',
        summary: 'Remove a task link',
        params: TaskParams.extend({ connectionId: IdSchema, identifier: z.string().min(1).max(512) }),
        response: z.undefined(),
        status: 204,
        handler: async (_ctx, { params }) => {
          await tasks.removeLink(params.taskId, params.connectionId, params.identifier)
          return NO_CONTENT
        },
      }),

      // ---- Pinned repositories (owner/name ↔ GitHub repo id via mirror) ----
      defineEndpoint({
        operationId: 'core.pinned-repository.list',
        pluginId: CORE,
        method: 'GET',
        path: '/pinned-repositories',
        scope: 'read',
        risk: 'read',
        summary: 'Ordered pinned repositories',
        response: z.strictObject({ items: z.array(PinnedRepoSchema) }),
        handler: async (ctx) => ({ items: await listPins(db, ctx.actor.principalId) }),
      }),
      defineEndpoint({
        operationId: 'core.pinned-repository.replace',
        pluginId: CORE,
        method: 'PUT',
        path: '/pinned-repositories',
        scope: 'write',
        risk: 'write',
        summary: 'Replace the ordered pinned repository set',
        body: ReplacePinnedReposSchema,
        response: z.strictObject({ items: z.array(PinnedRepoSchema) }),
        handler: async (ctx, { body }) => ({ items: await replacePins(db, ctx.actor.principalId, body.repos) }),
      }),
    ],
  }
}

// Pins are stored by GitHub repo id (schema.pinnedRepos) but exposed as owner/name. Resolve through
// the repos mirror; unknown repos are skipped on write and omitted on read.
async function listPins(db: AppDatabase, userLogin: string): Promise<z.infer<typeof PinnedRepoSchema>[]> {
  const pins = await db.select().from(schema.pinnedRepos).where(eq(schema.pinnedRepos.userId, userLogin)).orderBy(schema.pinnedRepos.sort)
  if (!pins.length) return []
  const repos = await db.select().from(schema.repos).where(eq(schema.repos.userId, userLogin))
  const byId = new Map(repos.map((r) => [r.id, r]))
  return pins.flatMap((p, i) => {
    const repo = byId.get(p.repoId)
    return repo ? [{ owner: repo.owner, name: repo.name, sort: i }] : []
  })
}

async function replacePins(
  db: AppDatabase,
  userLogin: string,
  repos: { owner: string; name: string }[],
): Promise<z.infer<typeof PinnedRepoSchema>[]> {
  const mirror = await db.select().from(schema.repos).where(eq(schema.repos.userId, userLogin))
  const idByKey = new Map(mirror.map((r) => [`${r.owner}/${r.name}`, r.id]))
  const unknown = repos.filter((r) => !idByKey.has(`${r.owner}/${r.name}`))
  if (unknown.length) {
    throw new PublicApiError('validation_failed', `Unknown repositories: ${unknown.map((r) => `${r.owner}/${r.name}`).join(', ')}`)
  }
  await db.delete(schema.pinnedRepos).where(eq(schema.pinnedRepos.userId, userLogin))
  const rows = repos.map((r, i) => ({ userId: userLogin, repoId: idByKey.get(`${r.owner}/${r.name}`)!, sort: i }))
  if (rows.length) await db.insert(schema.pinnedRepos).values(rows).onConflictDoNothing()
  return listPins(db, userLogin)
}
