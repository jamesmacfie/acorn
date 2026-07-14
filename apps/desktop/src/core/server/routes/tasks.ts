import { randomUUID } from 'node:crypto'
import { and, eq, inArray, max } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { Hono } from 'hono'
import type { Task, TaskLink, TaskLinkSeed, TaskSeed } from '../../shared/api'
import type { ExternalRef } from '../../shared/integrations'
import { externalRefForConnection, getConnection } from '../integrations/connections'
import { ProviderOperationError } from '../integrations/types'
import { getUser } from '../middleware/requireUser'
import { integrationProviderRegistry } from '../integrations/registry'

// Tasks (docs/workspaces-and-tasks.md): the single-repo unit of work. Machine-scoped like repo_paths /
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

type LinkInput = Partial<TaskLinkSeed> & { integrationId?: string; provider?: string }

const parseLinkInput = (input: LinkInput): { connectionId: string; identifier: string; ref?: Partial<ExternalRef>; claimedProviderId?: string } | null => {
  const connectionId = input.connectionId ?? input.integrationId
  if (!connectionId || !input.identifier) return null
  return { connectionId, identifier: input.identifier, ref: input.ref, claimedProviderId: input.providerId ?? input.provider }
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
  if (!parsed) throw new ProviderOperationError('provider_bad_config', 400)
  const connection = await getConnection(db, userId, parsed.connectionId)
  if (!connection) throw new ProviderOperationError('provider_not_connected', 403)
  if (parsed.claimedProviderId && parsed.claimedProviderId !== connection.provider) {
    throw new ProviderOperationError('provider_bad_config', 400)
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
  .get('/', async (c) => {
    const db = getDb(c.env)
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active')).orderBy(schema.tasks.sort)
    if (!rows.length) return c.json([] as Task[])
    const ids = rows.map((r) => r.id)
    const linkRows = await db.select().from(schema.taskLinks).where(inArray(schema.taskLinks.taskId, ids))
    const byTask = new Map<string, TaskLink[]>()
    for (const l of linkRows) {
      const list = byTask.get(l.taskId) ?? []
      list.push(rowLink(l))
      byTask.set(l.taskId, list)
    }
    return c.json(rows.map((r) => rowToTask(r, byTask.get(r.id) ?? [])))
  })
  .post('/', async (c) => {
    const seed = (await c.req.json().catch(() => ({}))) as Partial<TaskSeed>
    if (!seed.origin || !seed.repoOwner || !seed.repoName || !seed.branch) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    const user = getUser(c)
    const linkInputs = Array.isArray(seed.links) ? (seed.links as LinkInput[]) : []
    let links: TaskLink[]
    try {
      links = await Promise.all(linkInputs.map((link) => stampedLink(db, user.login, link)))
    } catch (error) {
      if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
      throw error
    }
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
    if (links.length) {
      await db
        .insert(schema.taskLinks)
        .values(links.map((l) => ({ taskId: id, integrationId: l.connectionId, provider: l.providerId, identifier: l.identifier, refJson: l.ref ? JSON.stringify(l.ref) : null, createdAt: now })))
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
    const body = (await c.req.json().catch(() => ({}))) as { title?: string; status?: 'active' | 'archived'; pullNumber?: number | null }
    const db = getDb(c.env)
    const [existing] = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, id))
    if (!existing) return respondError(c, 404, 'not_found')
    const patch: Partial<Row> = { updatedAt: Date.now() }
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
    if (body.status === 'archived' || body.status === 'active') {
      patch.status = body.status
      patch.archivedAt = body.status === 'archived' ? Date.now() : null
    }
    // Link a task to a PR after the fact (Flow B: local-first task → PR created → number back-filled).
    // Accept a positive number to set, or null to unlink.
    if (typeof body.pullNumber === 'number' && Number.isInteger(body.pullNumber) && body.pullNumber > 0) patch.pullNumber = body.pullNumber
    else if (body.pullNumber === null) patch.pullNumber = null
    await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, id))
    return c.json({ id, ...patch })
  })
  // Links grow/shrink after creation (docs/workspaces-and-tasks.md): the write path that turns "a task frozen
  // with its birth links" into "a task that accumulates context as work unfolds". Mirrors the
  // create-time insert above — same onConflictDoNothing, so a duplicate add is a no-op.
  .post('/:id/links', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as LinkInput
    const db = getDb(c.env)
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
    if (!t) return respondError(c, 404, 'not_found')
    let link: TaskLink
    try {
      link = await stampedLink(db, getUser(c).login, body)
    } catch (error) {
      if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
      throw error
    }
    await db
      .insert(schema.taskLinks)
      .values({ taskId: id, integrationId: link.connectionId, provider: link.providerId, identifier: link.identifier, refJson: link.ref ? JSON.stringify(link.ref) : null, createdAt: Date.now() })
      .onConflictDoNothing()
    return c.json({ ok: true })
  })
  .delete('/:id/links', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as Partial<Pick<TaskLink, 'connectionId' | 'identifier'>> & { integrationId?: string }
    const connectionId = body.connectionId ?? body.integrationId
    if (!connectionId || !body.identifier) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    await db
      .delete(schema.taskLinks)
      .where(
        and(
          eq(schema.taskLinks.taskId, id),
          eq(schema.taskLinks.integrationId, connectionId),
          eq(schema.taskLinks.identifier, body.identifier),
        ),
      )
    return c.json({ ok: true })
  })
