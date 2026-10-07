import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AppEnv } from '../../middleware/auth'
import { getDb, schema } from '../../db'
import { ownerId } from '../../middleware/requireUser'
import { respondError } from '../../respond'
import type { WorkspaceExternalProjectsResponse } from '@acorn/protocol/api.ts'
import { getConnection } from '../../integrations/connections'
import { broadcastWorkspaceProjectsChanged } from '../../notify'

type WorkspaceContext = Context<AppEnv>
type WorkspaceProjectCheck = (db: ReturnType<typeof getDb>, projectId: string, workspaceId: string) => Promise<boolean>

/** A link row on the wire omits projectId for a workspace-wide mapping. */
const toExternalProject = (row: { integrationId: string; externalId: string; projectId: string }) => ({
  integrationId: row.integrationId,
  externalId: row.externalId,
  ...(row.projectId ? { projectId: row.projectId } : {}),
})

const body = z.object({
  projects: z.array(z.object({
    integrationId: z.string().min(1),
    externalId: z.string().min(1),
    projectId: z.string().min(1).optional(),
  })).optional(),
})

const mappingKey = (row: { integrationId: string; externalId: string; projectId: string }) =>
  `${row.integrationId}\0${row.externalId}\0${row.projectId}`

const mappingsEqual = (
  before: { integrationId: string; externalId: string; projectId: string }[],
  after: { integrationId: string; externalId: string; projectId: string }[],
): boolean => {
  const previous = new Set(before.map(mappingKey))
  return previous.size === after.length && after.every((row) => previous.has(mappingKey(row)))
}

async function mappingProviders(db: ReturnType<typeof getDb>, userId: string, integrationIds: Iterable<string>): Promise<Set<string>> {
  const ids = [...new Set(integrationIds)]
  if (!ids.length) return new Set()
  const rows = await db.select({ provider: schema.integrations.provider }).from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), inArray(schema.integrations.id, ids)))
  return new Set(rows.map((row) => row.provider))
}

export async function readWorkspaceExternalProjects(c: WorkspaceContext) {
  const rows = await getDb(c.env).select().from(schema.workspaceExternalProjects)
    .where(eq(schema.workspaceExternalProjects.workspaceId, c.req.param('id')!))
  return c.json({ projects: rows.map(toExternalProject) } satisfies WorkspaceExternalProjectsResponse)
}

export async function writeWorkspaceExternalProjects(c: WorkspaceContext, projectInWorkspace: WorkspaceProjectCheck) {
  const id = c.req.param('id')!
  const parsed = body.safeParse(await c.req.json().catch(() => ({})))
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
    await db.insert(schema.workspaceExternalProjects).values(projects.map((p) => ({
      workspaceId: id, integrationId: p.integrationId, externalId: p.externalId,
      projectId: p.projectId ?? '', createdAt: now,
    }))).onConflictDoNothing()
  }
  const current = await db.select().from(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, id))
  if (!mappingsEqual(previous, current)) {
    const providers = await mappingProviders(db, uid, [...previous, ...current].map((mapping) => mapping.integrationId))
    for (const providerId of providers) broadcastWorkspaceProjectsChanged({ providerId, workspaceIds: [id] })
  }
  return c.json({ ok: true })
}
