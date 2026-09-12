import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq, inArray, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { ownerId } from '../../middleware/requireUser'
import { respondError } from '../../respond'
import type { Workspace, WorkspaceExternalProjectsResponse, WorkspaceProjectRef, WorkspaceSeed } from '@acorn/protocol/api.ts'
import { getConnection } from '../../integrations/connections'
import { broadcastProjectChanged, broadcastWorkspaceChanged, broadcastWorkspaceProjectsChanged } from '../../notify'

// Workspaces (docs/workspaces-and-tasks.md): named groups of Projects, the top-level unit.

/** A link row on the wire: '' is how the table spells "the whole workspace", the wire just omits it. */
export const toExternalProject = (row: { integrationId: string; externalId: string; projectId: string }) => ({
  integrationId: row.integrationId,
  externalId: row.externalId,
  ...(row.projectId ? { projectId: row.projectId } : {}),
})

/**
 * Whether this project is one of the workspace's own. A link scoped to a project in some other
 * workspace would never match anything, so it is a bad request rather than a row worth storing.
 */
export async function projectInWorkspace(db: ReturnType<typeof getDb>, projectId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)))
    .limit(1)
  return !!row
}

const workspaceExternalProjectsBody = z.object({
  projects: z.array(z.object({
    integrationId: z.string().min(1),
    externalId: z.string().min(1),
    // Omitted means the whole workspace. Stored as '' so the primary key covers it; see the schema.
    projectId: z.string().min(1).optional(),
  })).optional(),
})
const workspacePatchBody = z.object({ name: z.string().trim().min(1) }).strict()

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
    projects: (projectsByWs.get(r.id) ?? []).sort((a, b) => a.sort - b.sort),
  }))
}

const mappingKey = (row: { integrationId: string; externalId: string; projectId: string }) =>
  `${row.integrationId}\0${row.externalId}\0${row.projectId}`

const mappingsEqual = (
  before: { integrationId: string; externalId: string; projectId: string }[],
  after: { integrationId: string; externalId: string; projectId: string }[],
): boolean => {
  const previous = new Set(before.map(mappingKey))
  return previous.size === after.length && after.every((row) => previous.has(mappingKey(row)))
}

async function mappingProviders(
  db: ReturnType<typeof getDb>,
  userId: string,
  integrationIds: Iterable<string>,
): Promise<Set<string>> {
  const ids = [...new Set(integrationIds)]
  if (!ids.length) return new Set()
  const rows = await db
    .select({ provider: schema.integrations.provider })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), inArray(schema.integrations.id, ids)))
  return new Set(rows.map((row) => row.provider))
}

async function ensureDefault(db: ReturnType<typeof getDb>): Promise<{ id: string; created: boolean }> {
  const existing = await db.select().from(schema.workspaces).where(eq(schema.workspaces.isDefault, true)).limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }
  const now = Date.now()
  const id = randomUUID()
  await db.insert(schema.workspaces).values({ id, name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  return { id, created: true }
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
    const ensured = await ensureDefault(db)
    if (ensured.created) broadcastWorkspaceChanged({ workspaceId: ensured.id })
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
    broadcastWorkspaceChanged({ workspaceId: id })
    return c.json({ id, name: body.name.trim(), isDefault: false, sort: (value ?? -1) + 1, projects: [] } satisfies Workspace)
  })
  // Workspace identity is its name. Project colour and project configuration belong to project routes.
  .patch('/:id', async (c) => {
    const parsed = workspacePatchBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    const id = c.req.param('id')
    const [existing] = await db.select({ id: schema.workspaces.id, name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, id))
    if (!existing) return respondError(c, 404, 'not_found')
    if (existing.name !== parsed.data.name) {
      await db.update(schema.workspaces).set({ name: parsed.data.name, updatedAt: Date.now() }).where(eq(schema.workspaces.id, id))
      broadcastWorkspaceChanged({ workspaceId: id })
    }
    return c.json({ ok: true })
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const db = getDb(c.env)
    const row = (await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1))[0]
    if (!row) return respondError(c, 404, 'not_found')
    if (row.isDefault) return respondError(c, 400, 'cannot_delete_default')
    const reassignedProjects = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.workspaceId, id))
    const removedMappings = await db.select({ integrationId: schema.workspaceExternalProjects.integrationId }).from(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, id))
    const removedProviders = await mappingProviders(db, ownerId(c), removedMappings.map((mapping) => mapping.integrationId))
    const defaultWorkspace = await ensureDefault(db)
    // Reassign this workspace's projects back to Default rather than orphaning them.
    await db.update(schema.projects).set({ workspaceId: defaultWorkspace.id, updatedAt: Date.now() }).where(eq(schema.projects.workspaceId, id))
    await db.delete(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, id))
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id))
    if (defaultWorkspace.created) broadcastWorkspaceChanged({ workspaceId: defaultWorkspace.id })
    for (const project of reassignedProjects) broadcastProjectChanged({ projectId: project.id })
    for (const providerId of removedProviders) broadcastWorkspaceProjectsChanged({ providerId, workspaceIds: [id] })
    broadcastWorkspaceChanged({ workspaceId: id })
    return c.json({ ok: true })
  })
  // External projects (Linear/Rollbar/…) linked to this workspace: (integrationId, externalId) pairs.
  .get('/:id/external-projects', async (c) => {
    const db = getDb(c.env)
    const rows = await db.select().from(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, c.req.param('id')))
    return c.json({ projects: rows.map(toExternalProject) } satisfies WorkspaceExternalProjectsResponse)
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
    const previous = await db.select().from(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, id))
    for (const project of projects) {
      if (!(await getConnection(db, uid, project.integrationId))) return respondError(c, 403, 'provider_not_connected')
    }
    for (const project of projects) {
      if (project.projectId && !(await projectInWorkspace(db, project.projectId, id))) return respondError(c, 400, 'bad_request')
    }
    const now = Date.now()
    await db.delete(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, id))
    if (projects.length) {
      await db
        .insert(schema.workspaceExternalProjects)
        .values(projects.map((p) => ({
          workspaceId: id,
          integrationId: p.integrationId,
          externalId: p.externalId,
          projectId: p.projectId ?? '',
          createdAt: now,
        })))
        .onConflictDoNothing()
    }
    const current = await db.select().from(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, id))
    if (!mappingsEqual(previous, current)) {
      const providers = await mappingProviders(db, uid, [...previous, ...current].map((mapping) => mapping.integrationId))
      for (const providerId of providers) broadcastWorkspaceProjectsChanged({ providerId, workspaceIds: [id] })
    }
    return c.json({ ok: true })
  })
