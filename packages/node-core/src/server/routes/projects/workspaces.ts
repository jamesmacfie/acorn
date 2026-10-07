import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, asc, eq, inArray, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { ownerId } from '../../middleware/requireUser'
import { respondError } from '../../respond'
import type { Workspace, WorkspaceProjectRef, WorkspaceSeed } from '@acorn/protocol/api.ts'
import { broadcastProjectChanged, broadcastWorkspaceChanged } from '../../notify'
import { workspaceProjectOrderBody } from '@acorn/protocol/api.ts'
import { nodeWorkspacesMode, WORKSPACES_OFF_MESSAGE } from '../../workspacesMode'

// Workspaces (docs/workspaces-and-tasks.md): named groups of Projects, the top-level unit.

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

const workspacePatchBody = z.object({ name: z.string().trim().min(1) }).strict()

async function listWorkspaces(db: ReturnType<typeof getDb>): Promise<Workspace[]> {
  const rows = await db.select().from(schema.workspaces).orderBy(schema.workspaces.sort)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const projectRows = await db.select().from(schema.projects).where(inArray(schema.projects.workspaceId, ids))
    .orderBy(asc(schema.projects.sort), asc(schema.projects.createdAt), asc(schema.projects.id))
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
    if (nodeWorkspacesMode(db, ownerId(c)) === 'off') return c.json(await listWorkspaces(db))
    const ensured = await ensureDefault(db)
    if (ensured.created) broadcastWorkspaceChanged({ workspaceId: ensured.id })
    return c.json(await listWorkspaces(db))
  })
  .post('/', async (c) => {
    const db = getDb(c.env)
    if (nodeWorkspacesMode(db, ownerId(c)) === 'off') return respondError(c, 409, 'workspaces_off', [WORKSPACES_OFF_MESSAGE])
    const body = (await c.req.json().catch(() => ({}))) as Partial<WorkspaceSeed>
    if (!body.name?.trim()) return respondError(c, 400, 'bad_request')
    const [{ value }] = await db.select({ value: max(schema.workspaces.sort) }).from(schema.workspaces)
    const now = Date.now()
    const id = randomUUID()
    await db.insert(schema.workspaces).values({ id, name: body.name.trim(), isDefault: false, sort: (value ?? -1) + 1, createdAt: now, updatedAt: now })
    broadcastWorkspaceChanged({ workspaceId: id })
    return c.json({ id, name: body.name.trim(), isDefault: false, sort: (value ?? -1) + 1, projects: [] } satisfies Workspace)
  })
  // Workspace identity is its name. Project colour and project configuration belong to project routes.
  .patch('/:id', async (c) => {
    if (nodeWorkspacesMode(getDb(c.env), ownerId(c)) === 'off') return respondError(c, 409, 'workspaces_off', [WORKSPACES_OFF_MESSAGE])
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
  .put('/:id/project-order', async (c) => {
    const parsed = workspaceProjectOrderBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Supply each project ID once.'])
    const { reorderWorkspaceProjects } = await import('../../workspaceProjectOrder')
    const result = reorderWorkspaceProjects(getDb(c.env), c.req.param('id'), parsed.data.projectIds)
    if (result === 'not_found') return respondError(c, 404, 'not_found')
    if (result === 'membership_changed') return respondError(c, 409, 'conflict', ['The workspace projects changed. Refresh and try again.'])
    return c.json({ ok: true })
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const db = getDb(c.env)
    if (nodeWorkspacesMode(db, ownerId(c)) === 'off') return respondError(c, 409, 'workspaces_off', [WORKSPACES_OFF_MESSAGE])
    const row = (await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1))[0]
    if (!row) return respondError(c, 404, 'not_found')
    if (row.isDefault) return respondError(c, 400, 'cannot_delete_default')
    const reassignedProjects = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.workspaceId, id))
    const defaultWorkspace = await ensureDefault(db)
    const { removeWorkspaceRows, notifyWorkspaceRemoved } = await import('../../workspaceRemoval')
    // Reassign this workspace's projects back to Default rather than orphaning them.
    const removedProviders = db.transaction((tx) => {
      tx.update(schema.projects).set({ workspaceId: defaultWorkspace.id, updatedAt: Date.now() }).where(eq(schema.projects.workspaceId, id)).run()
      return removeWorkspaceRows(tx, db, id, ownerId(c))
    })
    if (defaultWorkspace.created) broadcastWorkspaceChanged({ workspaceId: defaultWorkspace.id })
    for (const project of reassignedProjects) broadcastProjectChanged({ projectId: project.id })
    notifyWorkspaceRemoved(id, removedProviders)
    return c.json({ ok: true })
  })
  // External projects (Linear/Rollbar/…) linked to this workspace: (integrationId, externalId) pairs.
  .get('/:id/external-projects', async (c) => (await import('./workspaceExternalProjects')).readWorkspaceExternalProjects(c))
  .put('/:id/external-projects', async (c) => {
    return (await import('./workspaceExternalProjects')).writeWorkspaceExternalProjects(c, projectInWorkspace)
  })
