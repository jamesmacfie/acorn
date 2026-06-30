import { randomUUID } from 'node:crypto'
import { eq, inArray, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import type { Workspace, WorkspaceLink, WorkspaceSeed } from '../../shared/api'

// Workspaces (docs/workspaces): the owning entity for a unit of work. Machine-scoped like
// repo_paths / terminal_sessions — no user_id — but still auth-gated (it's a logged-in app).
// CRUD: create / list-active / rename / archive. Worktree teardown on archive is the main
// process's job (it owns git/fs); this route only flips the status (P3 wires the IPC guard).

type Row = typeof schema.workspaces.$inferSelect

function rowToWorkspace(row: Row, links: WorkspaceLink[]): Workspace {
  return {
    id: row.id,
    title: row.title,
    origin: row.origin as Workspace['origin'],
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    branch: row.branch,
    worktreePath: row.worktreePath,
    pullNumber: row.pullNumber,
    status: row.status as Workspace['status'],
    sort: row.sort,
    links,
  }
}

export const workspaces = new Hono<AppEnv>()
  .get('/', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const db = getDb(c.env)
    const rows = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.status, 'active'))
      .orderBy(schema.workspaces.sort)
    if (!rows.length) return c.json([] as Workspace[])
    const ids = rows.map((r) => r.id)
    const linkRows = await db.select().from(schema.workspaceLinks).where(inArray(schema.workspaceLinks.workspaceId, ids))
    const byWs = new Map<string, WorkspaceLink[]>()
    for (const l of linkRows) {
      const list = byWs.get(l.workspaceId) ?? []
      list.push({ provider: l.provider, identifier: l.identifier })
      byWs.set(l.workspaceId, list)
    }
    return c.json(rows.map((r) => rowToWorkspace(r, byWs.get(r.id) ?? [])))
  })
  .post('/', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const seed = (await c.req.json().catch(() => ({}))) as Partial<WorkspaceSeed>
    if (!seed.origin || !seed.repoOwner || !seed.repoName || !seed.branch) return c.json({ error: 'bad_request' }, 400)
    const db = getDb(c.env)
    const [{ value }] = await db.select({ value: max(schema.workspaces.sort) }).from(schema.workspaces)
    const now = Date.now()
    const id = randomUUID()
    const title = seed.title?.trim() || (seed.pullNumber ? `#${seed.pullNumber} ${seed.repoName}` : `${seed.repoName} · ${seed.branch}`)
    await db.insert(schema.workspaces).values({
      id,
      title,
      origin: seed.origin,
      repoOwner: seed.repoOwner,
      repoName: seed.repoName,
      branch: seed.branch,
      pullNumber: seed.pullNumber ?? null,
      worktreePath: null,
      status: 'active',
      sort: (value ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    const links = (seed.links ?? []).filter((l) => l.provider && l.identifier)
    if (links.length) {
      await db
        .insert(schema.workspaceLinks)
        .values(links.map((l) => ({ workspaceId: id, provider: l.provider, identifier: l.identifier, createdAt: now })))
        .onConflictDoNothing()
    }
    return c.json(rowToWorkspace({ id, title, origin: seed.origin, repoOwner: seed.repoOwner, repoName: seed.repoName, branch: seed.branch, pullNumber: seed.pullNumber ?? null, worktreePath: null, status: 'active', sort: (value ?? -1) + 1, createdAt: now, updatedAt: now, archivedAt: null }, links))
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
    await db.update(schema.workspaces).set(patch).where(eq(schema.workspaces.id, id))
    return c.json({ id, ...patch })
  })
