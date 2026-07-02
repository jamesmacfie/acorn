import { randomUUID } from 'node:crypto'
import { eq, inArray, max } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
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
    sort: row.sort,
    links,
  }
}

export const tasks = new Hono<AppEnv>()
  .get('/', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
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
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const seed = (await c.req.json().catch(() => ({}))) as Partial<TaskSeed>
    if (!seed.origin || !seed.repoOwner || !seed.repoName || !seed.branch) return c.json({ error: 'bad_request' }, 400)
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
        { id, title, origin: seed.origin, repoOwner: seed.repoOwner, repoName: seed.repoName, branch: seed.branch, pullNumber: seed.pullNumber ?? null, worktreePath: null, status: 'active', sort, createdAt: now, updatedAt: now, archivedAt: null },
        links,
      ),
    )
  })
  .patch('/:id', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as { title?: string; status?: 'active' | 'archived' }
    const db = getDb(c.env)
    const patch: Partial<Row> = { updatedAt: Date.now() }
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
    if (body.status === 'archived' || body.status === 'active') {
      patch.status = body.status
      patch.archivedAt = body.status === 'archived' ? Date.now() : null
    }
    await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, id))
    return c.json({ id, ...patch })
  })
