import { recordSetupDecision } from '../../taskScripts/setup'
import { taskScripts } from '../../taskScripts/service'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, desc, eq, inArray, max } from 'drizzle-orm'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { respondError } from '../../respond'
import { broadcastTasksChanged } from '../../notify'
import { runHook } from '../../pluginHost/hooks'
import { Hono } from 'hono'
import { ICON_NAME_RE, type ArchivedTask, type Task, type TaskLink, type TaskLinkSeed } from '@acorn/protocol/api.ts'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import { externalRefForConnection, getConnection } from '../../integrations/connections'
import { providerRefusal } from '../../integrations/respondProvider'
import { isProviderOperationError, ProviderOperationError } from '../../integrations/types'
import { isTaskConfined, mayActOnTask, ownerId } from '../../middleware/requireUser'
import { integrationProviderRegistry } from '../../integrations/registry'
import { warmItemDetails } from '../../integrations/itemDetail'
import { getProject, type ProjectRow } from '../../projects'
import { unclaimedWorktrees } from '../../worktrees/taskWorktree'
import { resolve } from 'node:path'
import { saveTaskBranch, TaskBranchError, withBranchReservation } from '../../worktrees/taskBranch'

// Tasks (docs/workspaces-and-tasks.md): the single-project unit of work. Machine-scoped like projects
// and terminal_sessions, no user_id, but still auth-gated (it's a logged-in app). CRUD: create /
// list-active / rename / archive. Worktree teardown on archive is the main process's job (it owns
// git/fs); this route only flips the status and runs the archiving hook.

type Row = typeof schema.tasks.$inferSelect

// Zod at the mutation boundary (docs/architecture/node-api.md § Wire validation). The positive-integer
// constraint on pullNumber used to be three conjuncts of a `typeof` chain; getting it wrong here writes
// a bad row rather than returning a 400.
const taskPatchBody = z.object({
  title: z.string().optional(),
  icon: z.string().nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
  pullNumber: z.int().positive().nullable().optional(),
})

const cleanIcon = (v: unknown): string | null => (typeof v === 'string' && ICON_NAME_RE.test(v) ? v : null)

function rowToTask(row: Row, links: TaskLink[], project: Awaited<ReturnType<typeof getProject>>): Task | null {
  const projectId = row.projectId
  const github = project?.githubOwner && project.githubName
    ? { owner: project.githubOwner, name: project.githubName }
    : null
  return {
    id: row.id,
    title: row.title,
    icon: row.icon,
    origin: row.origin as Task['origin'],
    projectId,
    branch: row.branch,
    github,
    worktreePath: row.worktreePath,
    pullNumber: row.pullNumber,
    status: row.status as Task['status'],
    parentId: row.parentId,
    sort: row.sort,
    links,
  }
}

// The wire names only. This accepted `integrationId` and `provider` as aliases for `connectionId` and
// `providerId`, which was not input leniency but naming history leaking outward: those two are the
// storage column names (`task_links.integration_id`, `task_links.provider`), so the request body
// documented the schema instead of the API.
//
// The columns keep their names. Renaming them is a migration for no behavioural gain, and `rowLink`
// below is the one place that maps between the two vocabularies, which is where a mapping belongs.
type LinkInput = Partial<TaskLinkSeed>

const taskSeedBody = z.object({
  title: z.string().optional(),
  icon: z.string().optional(),
  origin: z.string().min(1),
  projectId: z.string().min(1),
  branch: z.string().optional(),
  branchSource: z.enum(['derived', 'exact']).optional(),
  baseBranch: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  skipSetup: z.boolean().optional(),
  pullNumber: z.int().positive().optional(),
  links: z.array(z.object({
    connectionId: z.string().min(1),
    identifier: z.string().min(1),
    providerId: z.string().optional(),
    ref: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
})

const parseLinkInput = (input: LinkInput): { connectionId: string; identifier: string; ref?: Partial<ExternalRef>; claimedProviderId?: string } | null => {
  if (!input.connectionId || !input.identifier) return null
  return { connectionId: input.connectionId, identifier: input.identifier, ref: input.ref, claimedProviderId: input.providerId }
}

const rowLink = (row: typeof schema.taskLinks.$inferSelect): TaskLink => {
  let ref: ExternalRef | undefined
  try {
    const fallback = { providerId: row.provider, connectionId: row.integrationId, displayId: row.identifier }
    ref = row.refJson
      ? integrationProviderRegistry.get(row.provider)?.externalIds.parse(JSON.parse(row.refJson), fallback) ?? undefined
      : undefined
  } catch {
    ref = undefined
  }
  return { connectionId: row.integrationId, providerId: row.provider, identifier: row.identifier, ref }
}

async function stampedLink(db: ReturnType<typeof getDb>, userId: string, input: LinkInput) {
  const parsed = parseLinkInput(input)
  if (!parsed) throw new ProviderOperationError('provider_bad_config', 400, 'A task link needs both a connectionId and an identifier.')
  const connection = await getConnection(db, userId, parsed.connectionId)
  if (!connection) throw new ProviderOperationError('provider_not_connected', 403)
  if (parsed.claimedProviderId && parsed.claimedProviderId !== connection.provider) {
    throw new ProviderOperationError('provider_bad_config', 400, `The link claims provider '${parsed.claimedProviderId}', but connection ${connection.id} is a ${connection.provider} connection.`)
  }
  const ref = externalRefForConnection(connection, parsed.identifier, parsed.ref)
  return {
    connectionId: connection.id,
    providerId: connection.provider,
    identifier: parsed.identifier,
    ref,
  } satisfies TaskLink
}

export const tasks = new Hono<AppEnv>()
  // Filtered for a task-confined caller rather than gated, the same answer /task-statuses and
  // terminal's session roster give (docs/security/transport-and-auth.md § Transport and auth). A row carries the task's
  // title, branch and absolute worktree path, so the unfiltered list hands an agent the shape of every
  // other piece of work on the machine. Its own row still comes back, because the renderer surfaces a
  // frame draws are entitled to it.
  //
  // `?status=archived` is the archive page's list instead: archived tasks, newest first, each with its
  // `archivedAt` (docs/workspaces-and-tasks.md § Restoring a task). Unbounded, like the active list. A
  // few hundred rows is a small scan; page it if a node ever holds thousands.
  .get('/', async (c) => {
    const db = getDb(c.env)
    const archived = c.req.query('status') === 'archived'
    const all = archived
      ? await db.select().from(schema.tasks).where(eq(schema.tasks.status, 'archived')).orderBy(desc(schema.tasks.archivedAt))
      : await db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active')).orderBy(schema.tasks.sort)
    const rows = isTaskConfined(c) ? all.filter((row) => mayActOnTask(c, row.id)) : all
    if (!rows.length) return c.json([] as Task[])
    const ids = rows.map((r) => r.id)
    const linkRows = await db.select().from(schema.taskLinks).where(inArray(schema.taskLinks.taskId, ids))
    const byTask = new Map<string, TaskLink[]>()
    for (const l of linkRows) {
      const list = byTask.get(l.taskId) ?? []
      list.push(rowLink(l))
      byTask.set(l.taskId, list)
    }
    // One query for every project the list mentions, not one per task. This was `await getProject` in
    // a loop over rows, so a hundred tasks in one project was a hundred identical `SELECT`s per list
    // read, and the list is read on every `tasks:changed`.
    const projectIds = [...new Set(rows.flatMap((row) => (row.projectId ? [row.projectId] : [])))]
    const projects = new Map<string, ProjectRow>()
    if (projectIds.length) {
      for (const project of await db.select().from(schema.projects).where(inArray(schema.projects.id, projectIds))) {
        projects.set(project.id, project)
      }
    }
    const list = rows.flatMap((r) => {
      const task = rowToTask(r, byTask.get(r.id) ?? [], r.projectId ? projects.get(r.projectId) ?? null : null)
      if (!task) return []
      return [archived ? { ...task, archivedAt: r.archivedAt ?? r.updatedAt } satisfies ArchivedTask : task]
    })
    return c.json(list)
  })
  .post('/', async (c) => {
    const parsedSeed = taskSeedBody.safeParse(await c.req.json().catch(() => null))
    if (!parsedSeed.success) return respondError(c, 400, 'bad_request')
    const seed = parsedSeed.data
    const db = getDb(c.env)
    const uid = ownerId(c)
    const project = await getProject(db, seed.projectId)
    if (!project) return respondError(c, 404, 'not_found', ['No such project.'])
    const linkInputs = (seed.links ?? []) as LinkInput[]
    let links: TaskLink[]
    try {
      links = await Promise.all(linkInputs.map((link) => stampedLink(db, uid, link)))
    } catch (error) {
      if (isProviderOperationError(error)) return providerRefusal(c, error)
      throw error
    }
    // Attaching an existing worktree: the path must be one git lists for this project and no active
    // task already uses, and the branch is whatever that worktree has checked out. Setup never runs,
    // because resolveTaskCwd only runs it for a worktree it created.
    let worktreePath: string | null = null
    let attachedBranch: string | null = null
    if (seed.worktreePath && seed.baseBranch !== undefined) return respondError(c, 400, 'bad_request', ['A base branch cannot be used with an existing worktree.'])
    if (seed.worktreePath) {
      if (isTaskConfined(c)) return respondError(c, 403, 'forbidden')
      const wanted = resolve(seed.worktreePath)
      const match = (await unclaimedWorktrees(db, project)).find((wt) => resolve(wt.path) === wanted)
      if (!match) return respondError(c, 409, 'worktree-unavailable', ['That worktree is not a free worktree of this project.'])
      worktreePath = match.path
      attachedBranch = match.branch
    }
    const [{ value }] = await db.select({ value: max(schema.tasks.sort) }).from(schema.tasks)
    const now = Date.now()
    const id = randomUUID()
    let branch = attachedBranch ?? (project.vcs === 'git' ? seed.branch || null : null)
    const projectLabel = project.githubName ?? project.name
    const title = seed.title?.trim() || (seed.pullNumber ? `#${seed.pullNumber} ${projectLabel}` : branch ? `${project.name} · ${branch}` : project.name)
    const sort = (value ?? -1) + 1
    const icon = cleanIcon(seed.icon)
    const save = (allocatedBranch: string | null) => {
      db.insert(schema.tasks).values({
        id,
        title,
        icon,
        origin: seed.origin,
        projectId: project.id,
        branch: allocatedBranch,
        skipSetup: seed.skipSetup ?? false,
        pullNumber: seed.pullNumber ?? null,
        worktreePath,
        status: 'active',
        sort,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      }).run()
      return allocatedBranch
    }
    try {
      branch = await withBranchReservation(db, async () => worktreePath
        ? save(branch)
        : saveTaskBranch(db, project, { branch, branchSource: seed.branchSource, baseBranch: seed.baseBranch }, save))
    } catch (error) {
      if (error instanceof TaskBranchError) return respondError(c, error.status, error.status === 400 ? 'bad_request' : 'worktree-unavailable', [error.message])
      throw error
    }
    if (links.length) {
      await db
        .insert(schema.taskLinks)
        .values(links.map((l) => ({ taskId: id, integrationId: l.connectionId, provider: l.providerId, identifier: l.identifier, refJson: l.ref ? JSON.stringify(l.ref) : null, createdAt: now })))
        .onConflictDoNothing()
      warmItemDetails({ db, secrets: c.env.SECRETS }, uid, links)
    }
    // Every write on this router announces itself (server/notify.ts § broadcastTasksChanged). The task
    // list is what the rail draws, so a second window that missed a create used to sit on a stale list
    // until it reconnected (docs/plugins.md § Hearing a core event).
    await recordSetupDecision(db, id, false)
    broadcastTasksChanged({ taskId: id })
    return c.json(
      rowToTask(
        { id, scriptGeneration: 1, scriptHistoryKnown: true, title, icon, origin: seed.origin, projectId: project.id, branch, skipSetup: seed.skipSetup ?? false, pullNumber: seed.pullNumber ?? null, worktreePath, status: 'active', parentId: null, sort, createdAt: now, updatedAt: now, archivedAt: null },
        links,
        project,
      ),
    )
  })
  .patch('/:id', async (c) => {
    const id = c.req.param('id')
    // Every field optional and every absent field left untouched, which is what makes this a PATCH.
    // The parse REPLACES a chain of hand-rolled `typeof` guards; it is deliberately lenient about
    // unknown keys (zod strips them) and strict about the ones it knows.
    const parsed = taskPatchBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const body = parsed.data
    const db = getDb(c.env)
    const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
    if (!existing) return respondError(c, 404, 'not_found')
    const patch: Partial<Row> = { updatedAt: Date.now() }
    if (body.title !== undefined && body.title.trim()) patch.title = body.title.trim()
    // A name to set, or null to clear back to the origin-derived default.
    if (typeof body.icon === 'string') patch.icon = cleanIcon(body.icon)
    else if (body.icon === null) patch.icon = null
    if (body.status !== undefined) {
      patch.status = body.status
      patch.archivedAt = body.status === 'archived' ? Date.now() : null
    }
    // Link a task to a PR after the fact (Flow B: local-first task → PR created → number back-filled).
    // Accept a positive number to set, or null to unlink.
    if (typeof body.pullNumber === 'number') patch.pullNumber = body.pullNumber
    else if (body.pullNumber === null) patch.pullNumber = null
    await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, id))
    // The client archives this way when it has no terminal plugin to run the full archive route. The
    // worktree stays, but the task's plugin work still stops (server/pluginHost/hooks.ts §
    // core:task-archiving). After the write, so nothing can start new work on the task in between.
    if (patch.status === 'active' && existing.status === 'archived') taskScripts(db).newGeneration(id)
    if (patch.status === 'archived' && existing.status !== 'archived') taskScripts(db).admit(id, 'teardown', 'not_applicable')
    if (patch.status === 'archived' && existing.status !== 'archived') await runHook('core:task-archiving', { taskId: id })
    const publicStateChanged =
      (patch.title !== undefined && patch.title !== existing.title)
      || (patch.icon !== undefined && patch.icon !== existing.icon)
      || (patch.status !== undefined && patch.status !== existing.status)
      || (patch.pullNumber !== undefined && patch.pullNumber !== existing.pullNumber)
    if (publicStateChanged) broadcastTasksChanged({ taskId: id })
    return c.json({ id, ...patch })
  })
  // Links grow/shrink after creation (docs/workspaces-and-tasks.md): the write path that turns "a task frozen
  // with its birth links" into "a task that accumulates context as work unfolds". Mirrors the
  // create-time insert above, same onConflictDoNothing, so a duplicate add is a no-op.
  .post('/:id/links', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as LinkInput
    const db = getDb(c.env)
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
    if (!t) return respondError(c, 404, 'not_found')
    let link: TaskLink
    try {
      link = await stampedLink(db, ownerId(c), body)
    } catch (error) {
      if (isProviderOperationError(error)) return providerRefusal(c, error)
      throw error
    }
    const [inserted] = await db
      .insert(schema.taskLinks)
      .values({ taskId: id, integrationId: link.connectionId, provider: link.providerId, identifier: link.identifier, refJson: link.ref ? JSON.stringify(link.ref) : null, createdAt: Date.now() })
      .onConflictDoNothing()
      .returning({ taskId: schema.taskLinks.taskId })
    if (inserted) {
      warmItemDetails({ db, secrets: c.env.SECRETS }, ownerId(c), [link])
      broadcastTasksChanged({ taskId: id })
    }
    return c.json({ ok: true })
  })
  .delete('/:id/links', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as Partial<Pick<TaskLink, 'connectionId' | 'identifier'>> & { integrationId?: string }
    const connectionId = body.connectionId ?? body.integrationId
    if (!connectionId || !body.identifier) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    const [deleted] = await db
      .delete(schema.taskLinks)
      .where(
        and(
          eq(schema.taskLinks.taskId, id),
          eq(schema.taskLinks.integrationId, connectionId),
          eq(schema.taskLinks.identifier, body.identifier),
        ),
      )
      .returning({ taskId: schema.taskLinks.taskId })
    if (deleted) broadcastTasksChanged({ taskId: id })
    return c.json({ ok: true })
  })
