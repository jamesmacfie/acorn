import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import { git } from './core/git'

// A project is a folder on this machine (server/db/schema.ts `projects`). Adding one requires nothing
// beyond an absolute existing directory: the VCS and
// GitHub facets are DETECTED, never demanded. `.git` present → vcs 'git'; an origin remote that
// parses as github.com/<owner>/<name> → the GitHub facet. Both are cached disk truth, refreshed by
// detectProject whenever the folder changes underneath us (git init, remote add, …).

export type ProjectRow = typeof schema.projects.$inferSelect

// Cross-plugin project identity. This is intentionally a projection rather than ProjectRow: plugin
// code may resolve scope and filesystem ownership, but it must not receive core's executable config,
// hidden/sort state, or a database handle (docs/data-layer.md § plugin databases).
export type ProjectRef = {
  id: string
  name: string
  path: string | null
  workspaceId: string
  github: { owner: string; name: string; repoId: number | null } | null
}

export type ProjectCreateRefInput = {
  name: string
  path?: string | null
  workspaceId?: string
  github?: { owner: string; name: string; repoId?: number | null }
}

export type ProjectUpdateRefInput = {
  path?: string | null
  githubRepoId?: number | null
}

export function toProjectRef(row: ProjectRow): ProjectRef {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    workspaceId: row.workspaceId,
    github: row.githubOwner && row.githubName
      ? { owner: row.githubOwner, name: row.githubName, repoId: row.githubRepoId }
      : null,
  }
}

export type ProjectFacets = {
  vcs: 'git' | null
  remoteUrl: string | null
  githubOwner: string | null
  githubName: string | null
  defaultBranch: string | null
}

// GitHub treats owner and repository names case-insensitively. Store the canonical form for all
// new/adopted facets, while lookup remains case-insensitive for older rows and migration data.
export const normalizeGithubPart = (value: string): string => value.trim().toLowerCase()

// Accept the https, ssh, and scp-like forms Git emits, with an optional .git suffix, case-insensitively
// (GitHub owners and repos are case-insensitive). The host is anchored so a URL such as
// https://example.com/github.com/acme/web cannot become a GitHub facet.
export function parseGithubRemote(url: string): { owner: string; name: string } | null {
  const match = /^(?:(?:https?|ssh):\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:)([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?$/i.exec(url.trim())
  return match ? { owner: match[1]!, name: match[2]! } : null
}

export async function detectFacets(path: string): Promise<ProjectFacets> {
  const none: ProjectFacets = { vcs: null, remoteUrl: null, githubOwner: null, githubName: null, defaultBranch: null }
  // A .git ENTRY, not directory: a linked worktree holds a .git file and is still a git checkout.
  if (!existsSync(join(path, '.git'))) return none

  // Exit code as data (core/vcs/git.ts): a repo with no origin remote is a git project, not an error.
  const remote = await git(['remote', 'get-url', 'origin'], { cwd: path, timeoutMs: 5_000 })
  const remoteUrl = remote.code === 0 ? remote.stdout.trim() || null : null
  const github = remoteUrl ? parseGithubRemote(remoteUrl) : null

  // origin/HEAD is only set once something resolved it (clone does; git init + remote add doesn't).
  const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: path, timeoutMs: 5_000 })
  const defaultBranch = head.code === 0 ? head.stdout.trim().replace(/^origin\//, '') || null : null

  return {
    vcs: 'git',
    remoteUrl,
    githubOwner: github ? normalizeGithubPart(github.owner) : null,
    githubName: github ? normalizeGithubPart(github.name) : null,
    defaultBranch,
  }
}

export type CreateProjectResult = { ok: true; project: ProjectRow } | { ok: false; reason: string }

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export async function defaultWorkspaceId(db: AppDatabase): Promise<string> {
  const [existing] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.isDefault, true))
  if (existing) return existing.id
  const id = randomUUID()
  const now = Date.now()
  await db.insert(schema.workspaces).values({ id, name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  return id
}

export async function createProject(
  db: AppDatabase,
  input: { path: string; workspaceId?: string; name?: string },
): Promise<CreateProjectResult> {
  if (!isAbsolute(input.path)) return { ok: false, reason: 'Path must be absolute.' }
  if (!isDir(input.path)) return { ok: false, reason: 'Directory does not exist.' }

  // Re-adding the same folder returns the existing project rather than minting a twin: the picker
  // flow is idempotent, and two rows over one folder would fight over config.
  const [already] = await db.select().from(schema.projects).where(eq(schema.projects.path, input.path))
  if (already) return { ok: true, project: already }

  let workspaceId = input.workspaceId
  if (workspaceId !== undefined) {
    const [workspace] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    if (!workspace) return { ok: false, reason: 'No such workspace.' }
  } else {
    workspaceId = await defaultWorkspaceId(db)
  }

  const facets = await detectFacets(input.path)
  const now = Date.now()
  const project: typeof schema.projects.$inferInsert = {
    id: randomUUID(),
    name: input.name?.trim() || facets.githubName || basename(input.path),
    path: input.path,
    workspaceId,
    ...facets,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.projects).values(project)
  return { ok: true, project: (await getProject(db, project.id))! }
}

export async function getProject(db: AppDatabase, id: string): Promise<ProjectRow | null> {
  const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id))
  return row ?? null
}

export async function listProjects(db: AppDatabase): Promise<ProjectRow[]> {
  return db.select().from(schema.projects).orderBy(asc(schema.projects.sort), asc(schema.projects.createdAt))
}

// The bridge from the legacy (owner, name) keying, and the resolution rule when two clones of one
// repo exist: the oldest project wins, deterministically. Callers that care about all clones read
// the table themselves.
export async function projectByGithub(db: AppDatabase, owner: string, name: string): Promise<ProjectRow | null> {
  const normalizedOwner = normalizeGithubPart(owner)
  const normalizedName = normalizeGithubPart(name)
  const [row] = await db
    .select()
    .from(schema.projects)
    .where(and(
      sql`lower(${schema.projects.githubOwner}) = ${normalizedOwner}`,
      sql`lower(${schema.projects.githubName}) = ${normalizedName}`,
    ))
    .orderBy(asc(schema.projects.createdAt), asc(schema.projects.id))
    .limit(1)
  return row ?? null
}

// Re-probe the folder and refresh the cached facets. Never clears the GitHub facet on a vanished
// remote if a task/pull history hangs off it — a remote can be temporarily re-pointed; losing the
// facet would orphan the github surfaces for no gain. It DOES clear when the whole .git goes away.
export async function detectProject(db: AppDatabase, id: string): Promise<ProjectRow | null> {
  const project = await getProject(db, id)
  if (!project?.path || !isDir(project.path)) return project
  const facets = await detectFacets(project.path)
  await db
    .update(schema.projects)
    .set({
      vcs: facets.vcs,
      remoteUrl: facets.remoteUrl,
      defaultBranch: facets.defaultBranch ?? project.defaultBranch,
      githubOwner: facets.githubOwner ?? (facets.vcs ? project.githubOwner : null),
      githubName: facets.githubName ?? (facets.vcs ? project.githubName : null),
      updatedAt: Date.now(),
    })
    .where(eq(schema.projects.id, id))
  return getProject(db, id)
}

export type PatchProjectInput = Partial<{ name: string; workspaceId: string; hidden: boolean; sort: number; path: string }>

export async function patchProject(db: AppDatabase, id: string, patch: PatchProjectInput): Promise<CreateProjectResult> {
  const project = await getProject(db, id)
  if (!project) return { ok: false, reason: 'No such project.' }
  const set: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, reason: 'Name cannot be blank.' }
    set.name = name
  }
  if (patch.workspaceId !== undefined) {
    const [workspace] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, patch.workspaceId))
    if (!workspace) return { ok: false, reason: 'No such workspace.' }
    set.workspaceId = patch.workspaceId
  }
  if (patch.hidden !== undefined) set.hidden = patch.hidden
  if (patch.sort !== undefined) set.sort = patch.sort
  if (patch.path !== undefined) {
    // Mapping a folder onto a path-NULL project (the "clone or pick folder" affordance for a
    // deferred GitHub import). Same checks as createProject, then a facet probe.
    if (!isAbsolute(patch.path)) return { ok: false, reason: 'Path must be absolute.' }
    if (!isDir(patch.path)) return { ok: false, reason: 'Directory does not exist.' }
    const [alreadyMapped] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.path, patch.path), ne(schema.projects.id, id)))
    if (alreadyMapped) return { ok: false, reason: 'Another project already uses that path.' }
    set.path = patch.path
  }
  if (Object.keys(set).length === 0) return { ok: true, project }
  await db
    .update(schema.projects)
    .set({ ...set, updatedAt: Date.now() })
    .where(eq(schema.projects.id, id))
  if (patch.path !== undefined) return { ok: true, project: (await detectProject(db, id))! }
  return { ok: true, project: (await getProject(db, id))! }
}

// Removes the row only — never touches the folder, and tasks pointing at it keep their absolute
// worktree paths.
/**
 * Delete a project and the tasks that belong to it.
 *
 * The tasks go because nothing else would ever collect them: `tasks.project_id` carries no foreign
 * key, so leaving them behind produces rows pointing at a project that no longer exists, invisible in
 * every rail and impossible to remove. Their links go with them for the same reason.
 *
 * Still row-only on disk: the project's folder and any task worktrees are never touched from here.
 */
export async function deleteProject(db: AppDatabase, id: string): Promise<void> {
  const taskIds = (await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.projectId, id))).map((row) => row.id)
  if (taskIds.length) {
    await db.delete(schema.taskLinks).where(inArray(schema.taskLinks.taskId, taskIds))
    await db.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds))
  }
  await db.delete(schema.projects).where(eq(schema.projects.id, id))
}

// Core-only write seam for importer plugins. The public project routes remain the richer UI/config
// surface; this pair is intentionally limited to the fields a later importer needs to create a
// deferred remote project and map it to a folder. It is not a general-purpose project mutation API.
export async function createProjectRef(db: AppDatabase, input: ProjectCreateRefInput): Promise<ProjectRef> {
  const name = input.name.trim()
  if (!name) throw new Error('Project name cannot be blank.')
  if (input.github && (!input.github.owner.trim() || !input.github.name.trim())) throw new Error('GitHub owner and name cannot be blank.')
  if (input.path !== undefined && input.path !== null) {
    const result = await createProject(db, { path: input.path, workspaceId: input.workspaceId, name })
    if (!result.ok) throw new Error(result.reason)
    if (input.github) {
      await db.update(schema.projects).set({
        githubOwner: normalizeGithubPart(input.github.owner),
        githubName: normalizeGithubPart(input.github.name),
        githubRepoId: input.github.repoId ?? null,
        updatedAt: Date.now(),
      }).where(eq(schema.projects.id, result.project.id))
    }
    return toProjectRef((await getProject(db, result.project.id))!)
  }

  const workspaceId = input.workspaceId ?? (await defaultWorkspaceId(db))
  const [workspace] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
  if (!workspace) throw new Error('No such workspace.')
  if (!input.github?.owner.trim() || !input.github.name.trim()) throw new Error('Deferred projects need a GitHub facet.')
  const now = Date.now()
  const id = randomUUID()
  await db.insert(schema.projects).values({
    id,
    name,
    path: null,
    workspaceId,
    githubOwner: normalizeGithubPart(input.github.owner),
    githubName: normalizeGithubPart(input.github.name),
    githubRepoId: input.github.repoId ?? null,
    createdAt: now,
    updatedAt: now,
  })
  return toProjectRef((await getProject(db, id))!)
}

export async function updateProjectRef(db: AppDatabase, id: string, patch: ProjectUpdateRefInput): Promise<ProjectRef | null> {
  const current = await getProject(db, id)
  if (!current) return null
  if (patch.path !== undefined) {
    if (patch.path === null) {
      await db.update(schema.projects).set({ path: null, updatedAt: Date.now() }).where(eq(schema.projects.id, id))
    } else {
      const result = await patchProject(db, id, { path: patch.path })
      if (!result.ok) throw new Error(result.reason)
      // A deferred importer project may be mapped to a plain folder before its GitHub remote is
      // available. `detectProject` clears disk-derived facets for that folder; preserve the explicit
      // importer facet until a later Git-backed probe can replace it.
      if (current.githubOwner && current.githubName && !result.project.githubOwner) {
        await db.update(schema.projects).set({ githubOwner: current.githubOwner, githubName: current.githubName, githubRepoId: current.githubRepoId, updatedAt: Date.now() }).where(eq(schema.projects.id, id))
      }
    }
  }
  if (patch.githubRepoId !== undefined) {
    await db.update(schema.projects).set({ githubRepoId: patch.githubRepoId, updatedAt: Date.now() }).where(eq(schema.projects.id, id))
  }
  const updated = await getProject(db, id)
  return updated ? toProjectRef(updated) : null
}
