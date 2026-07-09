import { randomUUID } from 'node:crypto'
import { and, eq, inArray, max } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { Hono } from 'hono'
import type { Task, TaskLink, TaskSeed } from '../../shared/api'

// Tasks (docs/workspaces): the single-repo unit of work. Machine-scoped like repo_paths /
// terminal_sessions — no user_id — but still auth-gated (it's a logged-in app). CRUD: create /
// list-active / rename / archive. Worktree teardown on archive is the main process's job (it owns
// git/fs); this route only flips the status.

type Row = typeof schema.tasks.$inferSelect

function rowToTask(row: Row, links: TaskLink[]): Task {
  return {
    id: row.id,
    title: row.title,
    origin: row.origin as Task['origin'],
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    branch: row.branch,
    worktreePath: row.worktreePath,
    pullNumber: row.pullNumber,
    status: row.status as Task['status'],
    parentId: row.parentId,
    sort: row.sort,
    links,
  }
}

export const tasks = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env)
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active')).orderBy(schema.tasks.sort)
    if (!rows.length) return c.json([] as Task[])
    const ids = rows.map((r) => r.id)
    const linkRows = await db.select().from(schema.taskLinks).where(inArray(schema.taskLinks.taskId, ids))
    const byTask = new Map<string, TaskLink[]>()
    for (const l of linkRows) {
      const list = byTask.get(l.taskId) ?? []
      list.push({ integrationId: l.integrationId, provider: l.provider, identifier: l.identifier })
      byTask.set(l.taskId, list)
    }
    return c.json(rows.map((r) => rowToTask(r, byTask.get(r.id) ?? [])))
  })
  .post('/', async (c) => {
    const seed = (await c.req.json().catch(() => ({}))) as Partial<TaskSeed>
    if (!seed.origin || !seed.repoOwner || !seed.repoName || !seed.branch) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    const [{ value }] = await db.select({ value: max(schema.tasks.sort) }).from(schema.tasks)
    const now = Date.now()
    const id = randomUUID()
    const title = seed.title?.trim() || (seed.pullNumber ? `#${seed.pullNumber} ${seed.repoName}` : `${seed.repoName} · ${seed.branch}`)
    const sort = (value ?? -1) + 1
    await db.insert(schema.tasks).values({
      id,
      title,
      origin: seed.origin,
      repoOwner: seed.repoOwner,
      repoName: seed.repoName,
      branch: seed.branch,
      pullNumber: seed.pullNumber ?? null,
      worktreePath: null,
      status: 'active',
      sort,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    const links = (seed.links ?? []).filter((l) => l.integrationId && l.provider && l.identifier)
    if (links.length) {
      await db
        .insert(schema.taskLinks)
        .values(links.map((l) => ({ taskId: id, integrationId: l.integrationId, provider: l.provider, identifier: l.identifier, createdAt: now })))
        .onConflictDoNothing()
    }
    return c.json(
      rowToTask(
        { id, title, origin: seed.origin, repoOwner: seed.repoOwner, repoName: seed.repoName, branch: seed.branch, pullNumber: seed.pullNumber ?? null, worktreePath: null, status: 'active', parentId: null, sort, createdAt: now, updatedAt: now, archivedAt: null },
        links,
      ),
    )
  })
  .patch('/:id', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as { title?: string; status?: 'active' | 'archived' }
    const db = getDb(c.env)
    const [existing] = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, id))
    if (!existing) return respondError(c, 404, 'not_found')
    const patch: Partial<Row> = { updatedAt: Date.now() }
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
    if (body.status === 'archived' || body.status === 'active') {
      patch.status = body.status
      patch.archivedAt = body.status === 'archived' ? Date.now() : null
    }
    await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, id))
    return c.json({ id, ...patch })
  })
  // Links grow/shrink after creation (docs/next 11 §A): the write path that turns "a task frozen
  // with its birth links" into "a task that accumulates context as work unfolds". Mirrors the
  // create-time insert above — same onConflictDoNothing, so a duplicate add is a no-op.
  .post('/:id/links', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as Partial<TaskLink>
    if (!body.integrationId || !body.provider || !body.identifier) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
    if (!t) return respondError(c, 404, 'not_found')
    await db
      .insert(schema.taskLinks)
      .values({ taskId: id, integrationId: body.integrationId, provider: body.provider, identifier: body.identifier, createdAt: Date.now() })
      .onConflictDoNothing()
    return c.json({ ok: true })
  })
  .delete('/:id/links', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as Partial<Pick<TaskLink, 'integrationId' | 'identifier'>>
    if (!body.integrationId || !body.identifier) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    await db
      .delete(schema.taskLinks)
      .where(
        and(
          eq(schema.taskLinks.taskId, id),
          eq(schema.taskLinks.integrationId, body.integrationId),
          eq(schema.taskLinks.identifier, body.identifier),
        ),
      )
    return c.json({ ok: true })
  })
