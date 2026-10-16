import { and, desc, eq, sql } from 'drizzle-orm'
import {
  chunkRowsByColumnBudget,
  type PluginDatabase,
  type RefreshResult,
  type RouteResult,
} from '@acorn/plugin-api/node'
import type { GitlabProject } from '../../shared/api'
import { projects, syncState } from '../../node/schema'
import { gl, glError, glJson, projectRef, type GitlabSession } from '../gitlabApi'
import { type GitlabEmit, NO_EMIT } from '../events'

// The projects the person is a member of, which is what the importer lists. Paths nest groups to any
// depth, so a project is found by its full path, compared without case.

type RestProject = {
  id: number
  path_with_namespace: string
  name: string
  default_branch: string | null
  visibility: string
  last_activity_at: string | null
}

export const PROJECTS_RESOURCE = 'projects'
const PAGE_SIZE = 100

const projectRow = (userId: string, project: RestProject, fetchedAt: number) => ({
  userId,
  id: project.id,
  path: project.path_with_namespace,
  name: project.name,
  defaultBranch: project.default_branch ?? null,
  private: project.visibility !== 'public',
  lastActivityAt: project.last_activity_at ? Date.parse(project.last_activity_at) : null,
  fetchedAt,
})

export const toPublicProject = (row: typeof projects.$inferSelect): GitlabProject => ({
  id: row.id,
  path: row.path,
  name: row.name,
  private: row.private,
  defaultBranch: row.defaultBranch,
  lastActivityAt: row.lastActivityAt,
})

export const readCachedProjects = (db: PluginDatabase, userId: string) =>
  db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.lastActivityAt))

/** Replace the owner's project mirror with GitLab's list, `maxPages` pages of 100 at most. */
export async function refreshProjects(
  session: GitlabSession,
  db: PluginDatabase,
  userId: string,
  maxPages: number,
  emit: GitlabEmit = NO_EMIT,
): Promise<RefreshResult> {
  const listed: RestProject[] = []
  for (let page = 1; page <= maxPages; page++) {
    const response = await gl(
      session,
      `/projects?membership=true&simple=true&order_by=last_activity_at&per_page=${PAGE_SIZE}&page=${page}`,
    )
    const failure = glError(response)
    if (failure) return { ok: false, failure }
    const batch = (await response.json()) as RestProject[]
    listed.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  const now = Date.now()
  const rows = listed.map((project) => projectRow(userId, project, now))
  await db.batch([
    db.delete(projects).where(eq(projects.userId, userId)),
    ...chunkRowsByColumnBudget(rows).map((part) => db.insert(projects).values(part)),
    db
      .insert(syncState)
      .values({ userId, resource: PROJECTS_RESOURCE, fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.userId, syncState.resource], set: { fetchedAt: now } }),
  ])
  emit('repos-changed')
  return { ok: true }
}

/** A project by its full path: from the mirror, or from GitLab and then into the mirror. */
export async function resolveProject(
  session: GitlabSession,
  db: PluginDatabase,
  userId: string,
  path: string,
): Promise<RouteResult<typeof projects.$inferSelect>> {
  const [cached] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(sql`lower(${projects.path})`, path.toLowerCase())))
  if (cached) return { ok: true, value: cached }
  const fetched = await glJson<RestProject>(session, `/projects/${projectRef(path)}`)
  if (!fetched.ok) return fetched
  const row = projectRow(userId, fetched.value, Date.now())
  await db
    .insert(projects)
    .values(row)
    .onConflictDoUpdate({ target: [projects.userId, projects.id], set: row })
  return { ok: true, value: row }
}

/** A mirrored project by path, with no call to GitLab. For the routes that read the mirror only. */
export async function mirroredProject(db: PluginDatabase, userId: string, path: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(sql`lower(${projects.path})`, path.toLowerCase())))
  return row ?? null
}
