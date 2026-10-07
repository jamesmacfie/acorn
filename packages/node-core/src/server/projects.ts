import { taskScripts } from './taskScripts/service'
import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import type { AppDatabase } from './db'
import { schema } from './db'
import { git } from './core/git'
import { retireTaskHead } from './worktrees/taskHeadObserver'
import { broadcastProjectChanged, broadcastTasksChanged, broadcastWorkspaceChanged } from './notify'
import { nodeWorkspacesMode, settleWorkspacesMode, WORKSPACES_OFF_MESSAGE } from './workspacesMode'
import { notifyWorkspaceRemoved, removeWorkspaceRows } from './workspaceRemoval'

// A project is a folder on this machine (server/db/schema.ts `projects`; docs/workspaces-and-tasks.md
// § Workspace and project covers facets generally). Adding one needs only an absolute existing
// directory: a `.git` entry sets the git facet, and an origin remote that parses as
// `github.com/<owner>/<name>` sets the GitHub facet. `detectProject` refreshes both whenever the
// folder changes underneath us.

export type ProjectRow = typeof schema.projects.$inferSelect

function nextProjectSort(db: AppDatabase, workspaceId: string): number {
  const row = db.select({ value: max(schema.projects.sort) }).from(schema.projects)
    .where(eq(schema.projects.workspaceId, workspaceId)).get()
  return (row?.value ?? -1) + 1
}

// Validate membership and save the whole order together. A stale table must not reorder a project
// that another client moved to a different workspace, or leave a partially saved order.
export function reorderWorkspaceProjects(db: AppDatabase, workspaceId: string, projectIds: readonly string[]) {
  const result = db.transaction((tx) => {
    if (!tx.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).get()) {
      return 'not_found' as const
    }
    const members = tx.select({ id: schema.projects.id, sort: schema.projects.sort }).from(schema.projects)
      .where(eq(schema.projects.workspaceId, workspaceId)).all()
    const ids = new Set(projectIds)
    if (ids.size !== projectIds.length || members.length !== ids.size || members.some((project) => !ids.has(project.id))) {
      return 'membership_changed' as const
    }
    const sorts = new Map(members.map((project) => [project.id, project.sort]))
    const changed: string[] = []
    const now = Date.now()
    projectIds.forEach((id, sort) => {
      if (sorts.get(id) === sort) return
      tx.update(schema.projects).set({ sort, updatedAt: now }).where(eq(schema.projects.id, id)).run()
      changed.push(id)
    })
    return changed
  })
  if (Array.isArray(result)) {
    for (const projectId of result) broadcastProjectChanged({ projectId })
  }
  return result
}

async function projectAtPath(db: AppDatabase, path: string, exceptId?: string): Promise<ProjectRow | undefined> {
  const canonicalPath = realpathSync(path)
  const registered = await db.select().from(schema.projects)
  return registered.find((row) => {
    if (!row.path || row.id === exceptId) return false
    if (row.path === path) return true
    try { return realpathSync(row.path) === canonicalPath }
    catch { return false }
  })
}

// Cross-plugin project identity, a projection rather than ProjectRow (docs/plugins/activation.md §
// Activation): a plugin may resolve scope and filesystem ownership, but never receives core's
// executable config, hidden/sort state, or a database handle.
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
// new facets, while lookup remains case-insensitive for rows written with mixed case.
export const normalizeGithubPart = (value: string): string => value.trim().toLowerCase()

// Accept the https, ssh, and scp-like forms Git emits, with an optional .git suffix, case-insensitively
// (GitHub owners and repos are case-insensitive). The host is anchored so a URL such as
// https://example.com/github.com/acme/web cannot become a GitHub facet.
export function parseGithubRemote(url: string): { owner: string; name: string } | null {
  const match = /^(?:(?:https?|ssh):\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:\/?)([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?$/i.exec(url.trim())
  return match ? { owner: match[1]!, name: match[2]! } : null
}

export async function detectFacets(path: string): Promise<ProjectFacets> {
  const none: ProjectFacets = { vcs: null, remoteUrl: null, githubOwner: null, githubName: null, defaultBranch: null }
  // A `.git` entry, not a directory: a linked worktree holds a `.git` file and is still a git
  // checkout.
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

export type CreateProjectResult = { ok: true; project: ProjectRow } | { ok: false; reason: string; code?: 'workspaces_off' }

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

type NewProject = Omit<typeof schema.projects.$inferInsert, 'id' | 'workspaceId' | 'sort' | 'createdAt' | 'updatedAt'>

function insertProject(db: AppDatabase, ownerId: string, input: NewProject, requestedWorkspaceId?: string): CreateProjectResult {
  const result = db.transaction((tx) => {
    const mode = settleWorkspacesMode(tx, ownerId)
    if (mode === 'off' && requestedWorkspaceId !== undefined) {
      // An explicit membership would let another caller bypass the one-project rule.
      throw new WorkspacesOffError()
    }
    const now = Date.now()
    let workspaceId = requestedWorkspaceId
    let createdWorkspace = false
    if (workspaceId) {
      if (!tx.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).get()) {
        throw new Error('No such workspace.')
      }
    } else if (mode === 'off') {
      workspaceId = randomUUID()
      const sort = tx.select({ value: max(schema.workspaces.sort) }).from(schema.workspaces).get()?.value ?? -1
      tx.insert(schema.workspaces).values({ id: workspaceId, name: input.name, isDefault: false, sort: sort + 1, createdAt: now, updatedAt: now }).run()
      createdWorkspace = true
    } else {
      const existing = tx.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.isDefault, true)).get()
      if (existing) workspaceId = existing.id
      else {
        workspaceId = randomUUID()
        tx.insert(schema.workspaces).values({ id: workspaceId, name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now }).run()
        createdWorkspace = true
      }
    }
    const id = randomUUID()
    const sort = tx.select({ value: max(schema.projects.sort) }).from(schema.projects).where(eq(schema.projects.workspaceId, workspaceId)).get()?.value ?? -1
    tx.insert(schema.projects).values({ ...input, id, workspaceId, sort: sort + 1, createdAt: now, updatedAt: now }).run()
    return { project: tx.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!, createdWorkspace }
  })
  if (result.createdWorkspace) broadcastWorkspaceChanged({ workspaceId: result.project.workspaceId })
  broadcastProjectChanged({ projectId: result.project.id })
  return { ok: true, project: result.project }
}

export class WorkspacesOffError extends Error {
  readonly code = 'workspaces_off'
  constructor() { super(WORKSPACES_OFF_MESSAGE) }
}

export async function createProject(
  db: AppDatabase,
  input: { path: string; workspaceId?: string; name?: string },
  ownerId = '',
): Promise<CreateProjectResult> {
  if (input.workspaceId !== undefined && nodeWorkspacesMode(db, ownerId) === 'off') {
    return { ok: false, code: 'workspaces_off', reason: WORKSPACES_OFF_MESSAGE }
  }
  if (!isAbsolute(input.path)) return { ok: false, reason: 'Path must be absolute.' }
  if (!isDir(input.path)) return { ok: false, reason: 'Directory does not exist.' }

  // Re-adding the same folder returns the existing project rather than minting a twin: the picker
  // flow is idempotent, and two rows over one folder would fight over config.
  const already = await projectAtPath(db, input.path)
  if (already) return { ok: true, project: already }

  const facets = await detectFacets(input.path)
  const project: NewProject = {
    name: input.name?.trim() || facets.githubName || basename(input.path),
    path: input.path,
    ...facets,
  }
  try { return insertProject(db, ownerId, project, input.workspaceId) }
  catch (error) {
    if (error instanceof WorkspacesOffError) return { ok: false, code: 'workspaces_off', reason: error.message }
    if (error instanceof Error && error.message === 'No such workspace.') return { ok: false, reason: error.message }
    throw error
  }
}

export async function getProject(db: AppDatabase, id: string): Promise<ProjectRow | null> {
  const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id))
  return row ?? null
}

export async function listProjects(db: AppDatabase): Promise<ProjectRow[]> {
  return db.select().from(schema.projects).orderBy(asc(schema.projects.sort), asc(schema.projects.createdAt), asc(schema.projects.id))
}

// Find a project by GitHub owner and repo, ignoring case. When several local projects point at the
// same repo, the oldest row wins, with id as a stable tie-breaker. Callers that need every clone read
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
// remote if a task or pull history hangs off it: a remote can be temporarily re-pointed, and
// losing the facet would orphan the github surfaces for no gain. It does clear when the whole
// .git directory goes away.
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
  broadcastProjectChanged({ projectId: id })
  return getProject(db, id)
}

export type PatchProjectInput = Partial<{ name: string; workspaceId: string; hidden: boolean; color: string | null; sort: number; path: string }>

export async function patchProject(db: AppDatabase, id: string, patch: PatchProjectInput, ownerId = ''): Promise<CreateProjectResult> {
  const project = await getProject(db, id)
  if (!project) return { ok: false, reason: 'No such project.' }
  const mode = nodeWorkspacesMode(db, ownerId)
  if (mode === 'off' && patch.workspaceId !== undefined && patch.workspaceId !== project.workspaceId) {
    return { ok: false, code: 'workspaces_off', reason: WORKSPACES_OFF_MESSAGE }
  }
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
    if (patch.workspaceId !== project.workspaceId) set.sort = nextProjectSort(db, patch.workspaceId)
  }
  if (patch.hidden !== undefined) set.hidden = patch.hidden
  if (patch.color !== undefined) set.color = patch.color
  if (patch.sort !== undefined) set.sort = patch.sort
  if (patch.path !== undefined) {
    // Mapping a folder onto a project with no path yet (the "clone or pick folder" affordance for
    // a deferred GitHub import). Same checks as createProject, then a facet probe.
    if (!isAbsolute(patch.path)) return { ok: false, reason: 'Path must be absolute.' }
    if (!isDir(patch.path)) return { ok: false, reason: 'Directory does not exist.' }
    const alreadyMapped = await projectAtPath(db, patch.path, id)
    if (alreadyMapped) return { ok: false, reason: 'Another project already uses that path.' }
    set.path = patch.path
  }
  if (Object.keys(set).length === 0) return { ok: true, project }
  db.transaction((tx) => {
    tx.update(schema.projects).set({ ...set, updatedAt: Date.now() }).where(eq(schema.projects.id, id)).run()
    if (mode === 'off' && set.name !== undefined) {
      tx.update(schema.workspaces).set({ name: set.name as string, updatedAt: Date.now() })
        .where(eq(schema.workspaces.id, project.workspaceId)).run()
    }
  })
  if (mode === 'off' && set.name !== undefined) broadcastWorkspaceChanged({ workspaceId: project.workspaceId })
  broadcastProjectChanged({ projectId: id })
  if (patch.path !== undefined) return { ok: true, project: (await detectProject(db, id))! }
  return { ok: true, project: (await getProject(db, id))! }
}

/**
 * Delete a project and the tasks that belong to it (docs/workspaces-and-tasks/projects.md
 * § Delete a project). Row-only: the project's folder and any task worktrees are never touched from here.
 */
export async function deleteProject(db: AppDatabase, id: string, ownerId = ''): Promise<void> {
  const project = await getProject(db, id)
  if (!project) return
  const removeWorkspace = nodeWorkspacesMode(db, ownerId) === 'off'
  const taskIds = (await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.projectId, id))).map((row) => row.id)
  for (const taskId of taskIds) taskScripts(db).interruptTask(taskId, 'cancelled')
  const removedProviders = db.transaction((tx) => {
    if (taskIds.length) {
      tx.delete(schema.taskPulls).where(inArray(schema.taskPulls.taskId, taskIds)).run()
      tx.delete(schema.taskScriptAttempts).where(inArray(schema.taskScriptAttempts.taskId, taskIds)).run()
      tx.delete(schema.taskLinks).where(inArray(schema.taskLinks.taskId, taskIds)).run()
      tx.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds)).run()
    }
    tx.delete(schema.projects).where(eq(schema.projects.id, id)).run()
    return removeWorkspace ? removeWorkspaceRows(tx, db, project.workspaceId, ownerId) : []
  })
  for (const taskId of taskIds) retireTaskHead(taskId)
  if (removeWorkspace) notifyWorkspaceRemoved(project.workspaceId, removedProviders)
  // The rail's task list just lost a batch of tasks in this project (./notify.ts §
  // broadcastTasksChanged). No task event when the project had none: public task state did not move.
  if (taskIds.length) broadcastTasksChanged({ taskId: null })
  broadcastProjectChanged({ projectId: id })
}

// Core-only write seam for importer plugins. The public project routes remain the richer UI/config
// surface; this pair covers only the fields a later importer needs to create a deferred remote
// project and map it to a folder, not a general-purpose project mutation API.
export async function createProjectRef(db: AppDatabase, input: ProjectCreateRefInput, ownerId = ''): Promise<ProjectRef> {
  const name = input.name.trim()
  if (!name) throw new Error('Project name cannot be blank.')
  if (input.github && (!input.github.owner.trim() || !input.github.name.trim())) throw new Error('GitHub owner and name cannot be blank.')
  if (input.path !== undefined && input.path !== null) {
    const result = await createProject(db, { path: input.path, workspaceId: input.workspaceId, name }, ownerId)
    if (!result.ok) throw result.code === 'workspaces_off' ? new WorkspacesOffError() : new Error(result.reason)
    if (input.github) {
      await db.update(schema.projects).set({
        githubOwner: normalizeGithubPart(input.github.owner),
        githubName: normalizeGithubPart(input.github.name),
        githubRepoId: input.github.repoId ?? null,
        updatedAt: Date.now(),
      }).where(eq(schema.projects.id, result.project.id))
      broadcastProjectChanged({ projectId: result.project.id })
    }
    return toProjectRef((await getProject(db, result.project.id))!)
  }

  if (!input.github?.owner.trim() || !input.github.name.trim()) throw new Error('Deferred projects need a GitHub facet.')
  const result = insertProject(db, ownerId, {
    name,
    path: null,
    githubOwner: normalizeGithubPart(input.github.owner),
    githubName: normalizeGithubPart(input.github.name),
    githubRepoId: input.github.repoId ?? null,
  }, input.workspaceId)
  if (!result.ok) throw new Error(result.reason)
  return toProjectRef(result.project)
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
  if (updated) broadcastProjectChanged({ projectId: id })
  return updated ? toProjectRef(updated) : null
}
