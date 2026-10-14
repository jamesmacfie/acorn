import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { and, asc, eq, max, sql } from 'drizzle-orm'
import type { ProjectRepository } from '@acorn/protocol/api.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { git } from '../core/git'
import { broadcastProjectChanged, broadcastWorkspaceChanged } from '../notify'
import { codeHostFor } from '../pluginHost/codeHosts'
import { nodeWorkspacesMode, settleWorkspacesMode, WORKSPACES_OFF_MESSAGE } from './workspacesMode'

// A project is a folder on this machine (server/db/schema.ts `projects`; docs/workspaces-and-tasks.md
// § Workspace and project covers facets generally). Adding one needs only an absolute existing
// directory: a `.git` entry sets the git facet, and an origin remote sets the repository facet, with the
// code host plugin that claims its host (docs/plugins/code-hosts.md). `detectProject` refreshes both
// whenever the folder changes underneath us.

export type ProjectRow = typeof schema.projects.$inferSelect

function nextProjectSort(db: AppDatabase, workspaceId: string): number {
  const row = db
    .select({ value: max(schema.projects.sort) })
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, workspaceId))
    .get()
  return (row?.value ?? -1) + 1
}

async function projectAtPath(db: AppDatabase, path: string, exceptId?: string): Promise<ProjectRow | undefined> {
  const canonicalPath = realpathSync(path)
  const registered = await db.select().from(schema.projects)
  return registered.find((row) => {
    if (!row.path || row.id === exceptId) return false
    if (row.path === path) return true
    try {
      return realpathSync(row.path) === canonicalPath
    } catch {
      return false
    }
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
  repository: ProjectRepository | null
  github: { owner: string; name: string; repoId: number | null } | null
}

export type ProjectCreateRefInput = {
  name: string
  path?: string | null
  workspaceId?: string
  repository?: { host: string; path: string; externalId?: string | null }
  github?: { owner: string; name: string; repoId?: number | null }
}

export type ProjectUpdateRefInput = {
  path?: string | null
  repositoryExternalId?: string | null
  githubRepoId?: number | null
}

export function toProjectRef(row: ProjectRow): ProjectRef {
  const repository = projectRepository(row)
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    workspaceId: row.workspaceId,
    repository,
    github: githubFacet(repository),
  }
}

type ProjectFacets = {
  vcs: 'git' | null
  remoteUrl: string | null
  repository: ProjectRepository | null
  defaultBranch: string | null
}

// GitHub treats owner and repository names case-insensitively. Store the canonical form for all
// new facets, while lookup remains case-insensitive for rows written with mixed case.
export const normalizeGithubPart = (value: string): string => value.trim().toLowerCase()

// Read any remote Git emits as a host and a path: https, ssh, and git URLs, and the scp-like
// `user@host:path`. Both come back lowercased, without a port, a user, or a `.git` suffix. GitHub,
// GitLab, and Bitbucket all match repository paths case-insensitively. A local path has no host and
// returns null.
export function parseGitRemote(url: string): { host: string; path: string } | null {
  const remote = url.trim()
  if (!remote || /\s/.test(remote)) return null
  let host: string
  let path: string
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
    if (!/^(?:https?|ssh|git|git\+ssh):\/\//i.test(remote)) return null
    let parsed: URL
    try {
      parsed = new URL(remote)
    } catch {
      return null
    }
    if (parsed.search || parsed.hash) return null
    host = parsed.hostname
    path = parsed.pathname
  } else {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote)
    if (!scp) return null
    host = scp[1]!
    path = scp[2]!
  }
  const repositoryPath = normalizeRepositoryPath(path)
  return host && repositoryPath ? { host: host.toLowerCase(), path: repositoryPath } : null
}

// `group/subgroup/repo`, lowercased, without one outer slash or a `.git` suffix. Null when a segment is
// empty, which also refuses `//group/repo`.
function normalizeRepositoryPath(raw: string): string | null {
  const path = raw
    .trim()
    .replace(/^\/|\/$/g, '')
    .replace(/\.git$/i, '')
    .toLowerCase()
  return path && path.split('/').every(Boolean) ? path : null
}

// The repository facet, with the live claim ahead of the stored provider. The stored one stands in only
// while no running plugin claims the host, so turning a code host off doesn't orphan its projects, and
// a provider stamped while another plugin held the host doesn't outlive that.
export function projectRepository(row: ProjectRow): ProjectRepository | null {
  if (!row.repoHost || !row.repoPath) return null
  return {
    provider: codeHostFor(row.repoHost) ?? row.repoProvider,
    host: row.repoHost,
    path: row.repoPath,
    externalId: row.repoExternalId,
  }
}

// The GitHub facet, read off a `github.com` repository whose path is an owner and a name. Kept for
// readers of the GitHub-named fields until the next plugin API major.
export function githubFacet(
  repository: { host: string; path: string; externalId?: string | null } | null,
): { owner: string; name: string; repoId: number | null } | null {
  if (repository?.host !== 'github.com') return null
  const [owner, name, ...rest] = repository.path.split('/')
  if (!owner || !name || rest.length) return null
  const repoId = Number(repository.externalId ?? NaN)
  return { owner, name, repoId: Number.isSafeInteger(repoId) ? repoId : null }
}

// Every column the repository facet owns, including the GitHub columns derived from it, so the two
// can't drift. Every write of the facet goes through here.
function repositoryColumns(repository: ProjectRepository | null) {
  const github = githubFacet(repository)
  return {
    repoProvider: repository?.provider ?? null,
    repoHost: repository?.host ?? null,
    repoPath: repository?.path ?? null,
    repoExternalId: repository?.externalId ?? null,
    githubOwner: github?.owner ?? null,
    githubName: github?.name ?? null,
    githubRepoId: github?.repoId ?? null,
  }
}

async function detectFacets(path: string): Promise<ProjectFacets> {
  const none: ProjectFacets = { vcs: null, remoteUrl: null, repository: null, defaultBranch: null }
  // A `.git` entry, not a directory: a linked worktree holds a `.git` file and is still a git
  // checkout.
  if (!existsSync(join(path, '.git'))) return none

  // Exit code as data (`git` in core): a repo with no origin remote is a git project, not an error.
  const remote = await git(['remote', 'get-url', 'origin'], { cwd: path, timeoutMs: 5_000 })
  const remoteUrl = remote.code === 0 ? remote.stdout.trim() || null : null
  const parsed = remoteUrl ? parseGitRemote(remoteUrl) : null

  // origin/HEAD is only set once something resolved it (clone does; git init + remote add doesn't).
  const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: path, timeoutMs: 5_000 })
  const defaultBranch = head.code === 0 ? head.stdout.trim().replace(/^origin\//, '') || null : null

  return {
    vcs: 'git',
    remoteUrl,
    repository: parsed ? { ...parsed, provider: codeHostFor(parsed.host), externalId: null } : null,
    defaultBranch,
  }
}

export type CreateProjectResult =
  | { ok: true; project: ProjectRow }
  | { ok: false; reason: string; code?: 'workspaces_off' }

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

type NewProject = Omit<typeof schema.projects.$inferInsert, 'id' | 'workspaceId' | 'sort' | 'createdAt' | 'updatedAt'>

function insertProject(
  db: AppDatabase,
  ownerId: string,
  input: NewProject,
  requestedWorkspaceId?: string,
): CreateProjectResult {
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
      if (
        !tx
          .select({ id: schema.workspaces.id })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, workspaceId))
          .get()
      ) {
        throw new Error('No such workspace.')
      }
    } else if (mode === 'off') {
      workspaceId = randomUUID()
      const sort =
        tx
          .select({ value: max(schema.workspaces.sort) })
          .from(schema.workspaces)
          .get()?.value ?? -1
      tx.insert(schema.workspaces)
        .values({ id: workspaceId, name: input.name, isDefault: false, sort: sort + 1, createdAt: now, updatedAt: now })
        .run()
      createdWorkspace = true
    } else {
      const existing = tx
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.isDefault, true))
        .get()
      if (existing) workspaceId = existing.id
      else {
        workspaceId = randomUUID()
        tx.insert(schema.workspaces)
          .values({ id: workspaceId, name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
          .run()
        createdWorkspace = true
      }
    }
    const id = randomUUID()
    const sort =
      tx
        .select({ value: max(schema.projects.sort) })
        .from(schema.projects)
        .where(eq(schema.projects.workspaceId, workspaceId))
        .get()?.value ?? -1
    tx.insert(schema.projects)
      .values({ ...input, id, workspaceId, sort: sort + 1, createdAt: now, updatedAt: now })
      .run()
    return { project: tx.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!, createdWorkspace }
  })
  if (result.createdWorkspace) broadcastWorkspaceChanged({ workspaceId: result.project.workspaceId })
  broadcastProjectChanged({ projectId: result.project.id })
  return { ok: true, project: result.project }
}

class WorkspacesOffError extends Error {
  readonly code = 'workspaces_off'
  constructor() {
    super(WORKSPACES_OFF_MESSAGE)
  }
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

  const { repository, ...facets } = await detectFacets(input.path)
  const project: NewProject = {
    name: input.name?.trim() || repository?.path.split('/').pop() || basename(input.path),
    path: input.path,
    ...facets,
    ...repositoryColumns(repository),
  }
  try {
    return insertProject(db, ownerId, project, input.workspaceId)
  } catch (error) {
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
  return db
    .select()
    .from(schema.projects)
    .orderBy(asc(schema.projects.sort), asc(schema.projects.createdAt), asc(schema.projects.id))
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
    .where(
      and(
        sql`lower(${schema.projects.githubOwner}) = ${normalizedOwner}`,
        sql`lower(${schema.projects.githubName}) = ${normalizedName}`,
      ),
    )
    .orderBy(asc(schema.projects.createdAt), asc(schema.projects.id))
    .limit(1)
  return row ?? null
}

// The oldest project whose remote is `path` on a host `provider` claims, matching projectByGithub's
// rule for two clones of one repository: the oldest row wins, with id as a stable tie-breaker.
export async function projectByRepository(db: AppDatabase, provider: string, path: string): Promise<ProjectRow | null> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.repoPath, path.trim().toLowerCase()))
    .orderBy(asc(schema.projects.createdAt), asc(schema.projects.id))
  return rows.find((row) => projectRepository(row)?.provider === provider) ?? null
}

// Re-probe the folder and refresh the cached facets. Never clears the repository facet on a vanished
// remote if a task or pull history hangs off it: a remote can be temporarily re-pointed, and losing
// the facet would orphan the code host's surfaces for no gain. It does clear when the whole .git
// directory goes away. The same repository keeps its provider and external id, even while the plugin
// that claimed it is off.
export async function detectProject(db: AppDatabase, id: string): Promise<ProjectRow | null> {
  const project = await getProject(db, id)
  if (!project?.path || !isDir(project.path)) return project
  const facets = await detectFacets(project.path)
  const stored = projectRepository(project)
  const detected = facets.repository
  const repository = !detected
    ? facets.vcs
      ? stored
      : null
    : stored?.host === detected.host && stored.path === detected.path
      ? { ...detected, provider: detected.provider ?? stored.provider, externalId: stored.externalId }
      : detected
  await db
    .update(schema.projects)
    .set({
      vcs: facets.vcs,
      remoteUrl: facets.remoteUrl,
      defaultBranch: facets.defaultBranch ?? project.defaultBranch,
      ...repositoryColumns(repository),
      updatedAt: Date.now(),
    })
    .where(eq(schema.projects.id, id))
  broadcastProjectChanged({ projectId: id })
  return getProject(db, id)
}

export type PatchProjectInput = Partial<{
  name: string
  workspaceId: string
  hidden: boolean
  color: string | null
  sort: number
  path: string
}>

export async function patchProject(
  db: AppDatabase,
  id: string,
  patch: PatchProjectInput,
  ownerId = '',
): Promise<CreateProjectResult> {
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
    const [workspace] = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, patch.workspaceId))
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
    tx.update(schema.projects)
      .set({ ...set, updatedAt: Date.now() })
      .where(eq(schema.projects.id, id))
      .run()
    if (mode === 'off' && set.name !== undefined) {
      tx.update(schema.workspaces)
        .set({ name: set.name as string, updatedAt: Date.now() })
        .where(eq(schema.workspaces.id, project.workspaceId))
        .run()
    }
  })
  if (mode === 'off' && set.name !== undefined) broadcastWorkspaceChanged({ workspaceId: project.workspaceId })
  broadcastProjectChanged({ projectId: id })
  if (patch.path !== undefined) return { ok: true, project: (await detectProject(db, id))! }
  return { ok: true, project: (await getProject(db, id))! }
}

// Core-only write seam for importer plugins. The public project routes remain the richer UI/config
// surface; this pair covers only the fields a later importer needs to create a deferred remote
// project and map it to a folder, not a general-purpose project mutation API.
export async function createProjectRef(
  db: AppDatabase,
  input: ProjectCreateRefInput,
  ownerId = '',
): Promise<ProjectRef> {
  const name = input.name.trim()
  if (!name) throw new Error('Project name cannot be blank.')
  if (input.github && (!input.github.owner.trim() || !input.github.name.trim()))
    throw new Error('GitHub owner and name cannot be blank.')
  const repository = inputRepository(input)
  if (input.path !== undefined && input.path !== null) {
    const result = await createProject(db, { path: input.path, workspaceId: input.workspaceId, name }, ownerId)
    if (!result.ok) throw result.code === 'workspaces_off' ? new WorkspacesOffError() : new Error(result.reason)
    if (repository) {
      await db
        .update(schema.projects)
        .set({ ...repositoryColumns(repository), updatedAt: Date.now() })
        .where(eq(schema.projects.id, result.project.id))
      broadcastProjectChanged({ projectId: result.project.id })
    }
    return toProjectRef((await getProject(db, result.project.id))!)
  }

  if (!repository) throw new Error('Deferred projects need a repository facet.')
  const result = insertProject(db, ownerId, { name, path: null, ...repositoryColumns(repository) }, input.workspaceId)
  if (!result.ok) throw new Error(result.reason)
  return toProjectRef(result.project)
}

// The repository an importer names, in the generic form or GitHub's, normalized like a parsed remote.
function inputRepository(input: ProjectCreateRefInput): ProjectRepository | null {
  const given =
    input.repository ??
    (input.github && {
      host: 'github.com',
      path: `${input.github.owner.trim()}/${input.github.name.trim()}`,
      externalId: input.github.repoId == null ? null : String(input.github.repoId),
    })
  if (!given) return null
  const host = given.host.trim().toLowerCase()
  const path = normalizeRepositoryPath(given.path)
  if (!host || !path) throw new Error('A repository needs a host and a path.')
  return { provider: codeHostFor(host), host, path, externalId: given.externalId ?? null }
}

// `holder` is set for a loaded plugin's call: it may set an external id only on a host it holds.
export async function updateProjectRef(
  db: AppDatabase,
  id: string,
  patch: ProjectUpdateRefInput,
  holder?: string,
): Promise<ProjectRef | null> {
  const current = await getProject(db, id)
  if (!current) return null
  if (patch.path !== undefined) {
    if (patch.path === null) {
      await db.update(schema.projects).set({ path: null, updatedAt: Date.now() }).where(eq(schema.projects.id, id))
    } else {
      const result = await patchProject(db, id, { path: patch.path })
      if (!result.ok) throw new Error(result.reason)
      // A deferred importer project may be mapped to a plain folder before its remote is available.
      // `detectProject` clears disk-derived facets for that folder; preserve the explicit importer
      // facet until a later Git-backed probe can replace it.
      const imported = projectRepository(current)
      if (imported && !result.project.repoHost) {
        await db
          .update(schema.projects)
          .set({ ...repositoryColumns(imported), updatedAt: Date.now() })
          .where(eq(schema.projects.id, id))
      }
    }
  }
  const externalId =
    patch.repositoryExternalId !== undefined
      ? patch.repositoryExternalId
      : patch.githubRepoId == null
        ? patch.githubRepoId
        : String(patch.githubRepoId)
  if (externalId !== undefined) {
    const row = await getProject(db, id)
    const repository = row && projectRepository(row)
    if (repository) {
      if (holder !== undefined && codeHostFor(repository.host) !== holder)
        throw new Error(`Only the code host that holds ${repository.host} can set its external id.`)
      // Only onto the repository just checked: a path change in this call or a concurrent one may have
      // re-pointed the project, and that repository's id isn't ours to write.
      await db
        .update(schema.projects)
        .set({ ...repositoryColumns({ ...repository, externalId }), updatedAt: Date.now() })
        .where(
          and(
            eq(schema.projects.id, id),
            eq(schema.projects.repoHost, repository.host),
            eq(schema.projects.repoPath, repository.path),
          ),
        )
    }
  }
  const updated = await getProject(db, id)
  if (updated) broadcastProjectChanged({ projectId: id })
  return updated ? toProjectRef(updated) : null
}
