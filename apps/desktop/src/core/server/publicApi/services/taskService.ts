import { randomUUID } from 'node:crypto'
import { and, eq, inArray, max } from 'drizzle-orm'
import type { z } from 'zod'
import type { AppDatabase } from '../../db'
import { schema } from '../../db'
import { externalRefForConnection, getConnection } from '../../integrations/connections'
import { integrationProviderRegistry } from '../../integrations/registry'
import type { ExternalRef } from '../../../shared/integrations'
import { PublicApiError } from '../../../shared/publicApi/errors'
import type {
  ArchiveTaskSchema,
  CreateTaskSchema,
  PatchTaskSchema,
  Task,
  TaskLinkInputSchema,
  TaskListQuerySchema,
  TaskStatusSchema,
} from '../../../shared/publicApi/resources'

// TaskService (docs/next/api/implementation-plan.md Phase 4). DB-level task domain returning the
// public Task shape. Worktree creation, accurate status, and archive teardown live in the main
// process; they are reached through an optional injected hook so this service stays runnable
// headlessly (lazy-worktree creation + simple archive always work).

type TaskRow = typeof schema.tasks.$inferSelect
type LinkInput = z.infer<typeof TaskLinkInputSchema>

// Main-process coordination for worktree-bearing operations. Absent in headless/dev:node contexts.
export interface TaskWorktreeHook {
  createWorktree(task: Task): Promise<{ worktreePath: string; branch: string }>
  adoptCheckout(task: Task): Promise<{ worktreePath: string; branch: string }>
  status(task: Task): Promise<{ dirty: boolean; dirtyCount: number; missing: boolean; runningSessionCount: number; runningWorkflowCount: number }>
  archive(task: Task, opts: z.infer<typeof ArchiveTaskSchema>): Promise<void>
}

function rowLink(row: typeof schema.taskLinks.$inferSelect): Task['links'][number] {
  let ref: ExternalRef | undefined
  try {
    const fallback = { providerId: row.provider, connectionId: row.integrationId, displayId: row.identifier }
    ref = row.refJson ? integrationProviderRegistry.get(row.provider)?.externalIds.parse(JSON.parse(row.refJson), fallback) ?? undefined : undefined
  } catch {
    ref = undefined
  }
  return { connectionId: row.integrationId, providerId: row.provider, identifier: row.identifier, ref }
}

function rowToTask(row: TaskRow, links: Task['links']): Task {
  return {
    id: row.id,
    title: row.title,
    origin: row.origin,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    branch: row.branch,
    worktreePath: row.worktreePath,
    pullNumber: row.pullNumber,
    status: row.status as Task['status'],
    parentId: row.parentId,
    sort: row.sort,
    links,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  }
}

export class TaskService {
  constructor(
    private readonly db: AppDatabase,
    private readonly hook: TaskWorktreeHook | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async linksFor(taskIds: string[]): Promise<Map<string, Task['links']>> {
    const byTask = new Map<string, Task['links']>()
    if (!taskIds.length) return byTask
    const rows = await this.db.select().from(schema.taskLinks).where(inArray(schema.taskLinks.taskId, taskIds))
    for (const l of rows) {
      const list = byTask.get(l.taskId) ?? []
      list.push(rowLink(l))
      byTask.set(l.taskId, list)
    }
    return byTask
  }

  async list(filter: z.infer<typeof TaskListQuerySchema>): Promise<Task[]> {
    let rows = await this.db.select().from(schema.tasks).orderBy(schema.tasks.sort)
    if (filter.status !== 'all') rows = rows.filter((r) => r.status === filter.status)
    if (filter.repoOwner) rows = rows.filter((r) => r.repoOwner === filter.repoOwner)
    if (filter.repoName) rows = rows.filter((r) => r.repoName === filter.repoName)
    if (filter.parentId) rows = rows.filter((r) => r.parentId === filter.parentId)
    if (filter.workspaceId) {
      const repoRows = await this.db.select().from(schema.workspaceRepos).where(eq(schema.workspaceRepos.workspaceId, filter.workspaceId))
      const inWs = new Set(repoRows.map((r) => `${r.repoOwner}/${r.repoName}`))
      rows = rows.filter((r) => inWs.has(`${r.repoOwner}/${r.repoName}`))
    }
    const links = await this.linksFor(rows.map((r) => r.id))
    return rows.map((r) => rowToTask(r, links.get(r.id) ?? []))
  }

  async get(id: string): Promise<Task | null> {
    const [row] = await this.db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1)
    if (!row) return null
    const links = await this.linksFor([id])
    return rowToTask(row, links.get(id) ?? [])
  }

  async getOrThrow(id: string): Promise<Task> {
    const t = await this.get(id)
    if (!t) throw new PublicApiError('not_found', 'Task not found')
    return t
  }

  private async stampLink(userLogin: string, input: LinkInput): Promise<Task['links'][number]> {
    const connection = await getConnection(this.db, userLogin, input.connectionId)
    if (!connection) throw new PublicApiError('provider_validation_failed', 'Integration is not connected')
    if (input.providerId && input.providerId !== connection.provider) {
      throw new PublicApiError('provider_mismatch', 'Claimed providerId does not match the connection')
    }
    const ref = externalRefForConnection(connection, input.identifier, input.ref)
    return { connectionId: connection.id, providerId: connection.provider, identifier: input.identifier, ref }
  }

  async create(input: z.infer<typeof CreateTaskSchema>, userLogin: string): Promise<Task> {
    const links = await Promise.all((input.links ?? []).map((l) => this.stampLink(userLogin, l)))
    const [{ value }] = await this.db.select({ value: max(schema.tasks.sort) }).from(schema.tasks)
    const now = this.now()
    const id = randomUUID()
    const title = input.title?.trim() || (input.pullNumber ? `#${input.pullNumber} ${input.repoName}` : `${input.repoName} · ${input.branch}`)
    const sort = (value ?? -1) + 1

    await this.db.insert(schema.tasks).values({
      id,
      title,
      origin: input.origin,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      branch: input.branch,
      pullNumber: input.pullNumber ?? null,
      worktreePath: null,
      status: 'active',
      sort,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    if (links.length) {
      await this.db
        .insert(schema.taskLinks)
        .values(links.map((l) => ({ taskId: id, integrationId: l.connectionId, provider: l.providerId, identifier: l.identifier, refJson: l.ref ? JSON.stringify(l.ref) : null, createdAt: now })))
        .onConflictDoNothing()
    }

    let task = await this.getOrThrow(id)
    // Immediate worktree modes need the main process. If the hook is absent, the row is rolled back
    // so the caller never sees a half-created task (core-api.md §7).
    if (input.checkout.mode !== 'lazy-worktree') {
      if (!this.hook) {
        await this.db.delete(schema.tasks).where(eq(schema.tasks.id, id))
        throw new PublicApiError('capability_unavailable', 'Immediate worktree creation requires the desktop runtime')
      }
      try {
        const { worktreePath } = input.checkout.mode === 'current-checkout' ? await this.hook.adoptCheckout(task) : await this.hook.createWorktree(task)
        await this.db.update(schema.tasks).set({ worktreePath, updatedAt: this.now() }).where(eq(schema.tasks.id, id))
        task = await this.getOrThrow(id)
      } catch (e) {
        await this.db.delete(schema.tasks).where(eq(schema.tasks.id, id))
        if (e instanceof PublicApiError) throw e
        throw new PublicApiError('internal_error', 'Worktree setup failed; the task was rolled back')
      }
    }
    return task
  }

  async patch(id: string, patch: z.infer<typeof PatchTaskSchema>): Promise<Task> {
    const existing = await this.get(id)
    if (!existing) throw new PublicApiError('not_found', 'Task not found')
    const set: Partial<TaskRow> = { updatedAt: this.now() }
    if (patch.title !== undefined) set.title = patch.title
    if (patch.sort !== undefined) set.sort = patch.sort
    await this.db.update(schema.tasks).set(set).where(eq(schema.tasks.id, id))
    return this.getOrThrow(id)
  }

  async archive(id: string, opts: z.infer<typeof ArchiveTaskSchema>): Promise<Task> {
    const task = await this.get(id)
    if (!task) throw new PublicApiError('not_found', 'Task not found')
    // Worktree teardown/removal is a main-process concern. Without the hook we can only archive a
    // task that has no worktree, rather than silently orphaning one.
    if (task.worktreePath && (opts.deleteWorktree || !opts.skipTeardown)) {
      if (!this.hook) throw new PublicApiError('capability_unavailable', 'Archiving a worktree-bearing task requires the desktop runtime')
      await this.hook.archive(task, opts)
    }
    await this.db.update(schema.tasks).set({ status: 'archived', archivedAt: this.now(), updatedAt: this.now() }).where(eq(schema.tasks.id, id))
    return this.getOrThrow(id)
  }

  async restore(id: string): Promise<Task> {
    const task = await this.get(id)
    if (!task) throw new PublicApiError('not_found', 'Task not found')
    await this.db.update(schema.tasks).set({ status: 'active', archivedAt: null, updatedAt: this.now() }).where(eq(schema.tasks.id, id))
    return this.getOrThrow(id)
  }

  async status(id: string): Promise<z.infer<typeof TaskStatusSchema>> {
    const task = await this.getOrThrow(id)
    if (this.hook) {
      const s = await this.hook.status(task)
      return { taskId: id, worktreePath: task.worktreePath, ...s }
    }
    // Headless fallback: report the persisted worktree path with unknown runtime detail as zero.
    return { taskId: id, worktreePath: task.worktreePath, dirty: false, dirtyCount: 0, missing: false, runningSessionCount: 0, runningWorkflowCount: 0 }
  }

  async listLinks(id: string): Promise<Task['links']> {
    await this.getOrThrow(id)
    return (await this.linksFor([id])).get(id) ?? []
  }

  async addLink(id: string, input: LinkInput, userLogin: string): Promise<Task['links'][number]> {
    await this.getOrThrow(id)
    const link = await this.stampLink(userLogin, input)
    await this.db
      .insert(schema.taskLinks)
      .values({ taskId: id, integrationId: link.connectionId, provider: link.providerId, identifier: link.identifier, refJson: link.ref ? JSON.stringify(link.ref) : null, createdAt: this.now() })
      .onConflictDoNothing()
    return link
  }

  async removeLink(id: string, connectionId: string, identifier: string): Promise<void> {
    await this.db
      .delete(schema.taskLinks)
      .where(and(eq(schema.taskLinks.taskId, id), eq(schema.taskLinks.integrationId, connectionId), eq(schema.taskLinks.identifier, identifier)))
  }
}
