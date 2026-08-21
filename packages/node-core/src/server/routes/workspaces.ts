import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { eq, inArray, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { respondError } from '../respond'
import type { Workspace, WorkspaceExternalProjectsResponse, WorkspaceProjectRef, WorkspaceSeed } from '@acorn/protocol/api.ts'
import { isValidWorkspaceColor, isValidWorkspaceIcon, parseWorkspaceIcon, serializeWorkspaceIcon } from '@acorn/protocol/workspaceIdentity.ts'
import { getConnection } from '../integrations/connections'

// Workspaces (docs/workspaces-and-tasks.md): named groups of Projects, the top-level unit.

const workspaceExternalProjectsBody = z.object({
  projects: z.array(z.object({ integrationId: z.string().min(1), externalId: z.string().min(1) })).optional(),
})

async function listWorkspaces(db: ReturnType<typeof getDb>): Promise<Workspace[]> {
  const rows = await db.select().from(schema.workspaces).orderBy(schema.workspaces.sort)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const projectRows = await db.select().from(schema.projects).where(inArray(schema.projects.workspaceId, ids))
  const projectsByWs = new Map<string, WorkspaceProjectRef[]>()
  for (const project of projectRows) {
    const list = projectsByWs.get(project.workspaceId) ?? []
    list.push({ id: project.id, name: project.name, sort: project.sort })
    projectsByWs.set(project.workspaceId, list)
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    sort: r.sort,
    icon: parseWorkspaceIcon(r.icon),
    color: r.color,
    projects: (projectsByWs.get(r.id) ?? []).sort((a, b) => a.sort - b.sort),
  }))
}

async function ensureDefault(db: ReturnType<typeof getDb>): Promise<string> {
  const existing = await db.select().from(schema.workspaces).where(eq(schema.workspaces.isDefault, true)).limit(1)
  if (existing[0]) return existing[0].id
  const now = Date.now()
  const id = randomUUID()
  await db.insert(schema.workspaces).values({ id, name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  return id
}

export const workspaces = new Hono<AppEnv>()
  .get('/', async (c) => {
    return c.json(await listWorkspaces(getDb(c.env)))
  })
  // Idempotent first-run setup: the core owns only the Default workspace. Provider candidates are
  // imported explicitly through their plugin-owned importer; boot must not turn a disposable mirror
  // projection into application-owned project state.
  .post('/bootstrap', async (c) => {
    const db = getDb(c.env)
    await ensureDefault(db)
    return c.json(await listWorkspaces(db))
  })
  .post('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<WorkspaceSeed>
    if (!body.name?.trim()) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    const [{ value }] = await db.select({ value: max(schema.workspaces.sort) }).from(schema.workspaces)
    const now = Date.now()
    const id = randomUUID()
    await db.insert(schema.workspaces).values({ id, name: body.name.trim(), isDefault: false, sort: (value ?? -1) + 1, createdAt: now, updatedAt: now })
    return c.json({ id, name: body.name.trim(), isDefault: false, sort: (value ?? -1) + 1, icon: null, color: null, projects: [] } satisfies Workspace)
  })
  // Update a workspace's identity (name / icon / colour). Project configuration is owned by the
  // project routes.
  .patch('/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; icon?: unknown; color?: string | null }
    const set: { name?: string; icon?: string | null; color?: string | null; updatedAt: number } = { updatedAt: Date.now() }
    if (body.name !== undefined) {
      if (!body.name.trim()) return respondError(c, 400, 'bad_request')
      set.name = body.name.trim()
    }
    // Identity (docs/workspaces-and-tasks.md): icon is a validated JSON union stored as text; colour a preset token
    // or 6-hex. Explicit null clears either back to the derived default.
    if (body.icon !== undefined) {
      if (body.icon === null) set.icon = null
      else if (isValidWorkspaceIcon(body.icon)) set.icon = serializeWorkspaceIcon(body.icon)
      else return respondError(c, 400, 'bad_request')
    }
    if (body.color !== undefined) {
      if (body.color === null || body.color === '') set.color = null
      else if (isValidWorkspaceColor(body.color)) set.color = body.color
      else return respondError(c, 400, 'bad_request')
    }
    if (set.name === undefined && set.icon === undefined && set.color === undefined) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    const id = c.req.param('id')
    const [existing] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, id))
    if (!existing) return respondError(c, 404, 'not_found')
    await db.update(schema.workspaces).set(set).where(eq(schema.workspaces.id, id))
    return c.json({ ok: true })
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const db = getDb(c.env)
    const row = (await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1))[0]
    if (!row) return respondError(c, 404, 'not_found')
    if (row.isDefault) return respondError(c, 400, 'cannot_delete_default')
    const defaultId = await ensureDefault(db)
    // Reassign this workspace's projects back to Default rather than orphaning them.
    await db.update(schema.projects).set({ workspaceId: defaultId, updatedAt: Date.now() }).where(eq(schema.projects.workspaceId, id))
    await db.delete(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, id))
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id))
    return c.json({ ok: true })
  })
  // External projects (Linear/Rollbar/…) linked to this workspace: (integrationId, externalId) pairs.
  .get('/:id/external-projects', async (c) => {
    const db = getDb(c.env)
    const rows = await db.select().from(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, c.req.param('id')))
    return c.json({ projects: rows.map((r) => ({ integrationId: r.integrationId, externalId: r.externalId })) } satisfies WorkspaceExternalProjectsResponse)
  })
  .put('/:id/external-projects', async (c) => {
    const id = c.req.param('id')
    // Zod at the mutation boundary (docs/architecture-overview.md § Wire validation). Non-empty rather
    // than merely present: an empty id would have passed the old `typeof` filter and then failed the
    // connection check below with a confusing 403.
    const parsed = workspaceExternalProjectsBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const projects = parsed.data.projects ?? []
    const db = getDb(c.env)
    const uid = ownerId(c)
    for (const project of projects) {
      if (!(await getConnection(db, uid, project.integrationId))) return respondError(c, 403, 'provider_not_connected')
    }
    const now = Date.now()
    await db.delete(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, id))
    if (projects.length) {
      await db
        .insert(schema.workspaceExternalProjects)
        .values(projects.map((p) => ({ workspaceId: id, integrationId: p.integrationId, externalId: p.externalId, createdAt: now })))
        .onConflictDoNothing()
    }
    return c.json({ ok: true })
  })
