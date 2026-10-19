import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import type { CoreServices, TaskRef } from '@acorn/plugin-api/node'
import type { WorktreeInventory, Worktree } from '../shared/api'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks'>
type Entry = Pick<Worktree, 'path' | 'head' | 'branch' | 'main' | 'locked' | 'prunable'>
const MAX_FILES = 100
const MAX_ROSTER_BYTES = 1 << 20

export function parseRoster(output: string): Entry[] {
  const entries: Entry[] = []
  for (const block of output.split('\0\0')) {
    const fields = block.split('\0')
    if (!fields[0]?.startsWith('worktree ')) continue
    const entry: Entry = {
      path: fields[0].slice(9),
      head: null,
      branch: null,
      main: entries.length === 0,
      locked: false,
      prunable: false,
    }
    for (const field of fields.slice(1)) {
      if (field.startsWith('HEAD ')) entry.head = field.slice(5)
      else if (field.startsWith('branch refs/heads/')) entry.branch = field.slice(18)
      else if (field === 'locked' || field.startsWith('locked ')) entry.locked = true
      else if (field === 'prunable' || field.startsWith('prunable ')) entry.prunable = true
    }
    entries.push(entry)
  }
  return entries
}

export async function canonicalPath(path: string): Promise<string> {
  try {
    return normalize(await realpath(path))
  } catch {
    const absolute = resolve(path)
    let ancestor = dirname(absolute)
    while (ancestor !== dirname(ancestor)) {
      try {
        return normalize(join(await realpath(ancestor), relative(ancestor, absolute)))
      } catch {
        ancestor = dirname(ancestor)
      }
    }
    return normalize(absolute)
  }
}

const message = (stderr: string, fallback: string) => stderr.trim().split('\n')[0] || fallback
const observation = (repository: string, entry: Entry): string =>
  createHash('sha256')
    .update(
      JSON.stringify([repository, entry.path, entry.head, entry.branch, entry.main, entry.locked, entry.prunable]),
    )
    .digest('hex')
const worktreeId = (repository: string, path: string): string =>
  createHash('sha256')
    .update(JSON.stringify([repository, path]))
    .digest('hex')

async function describe(
  core: Core,
  repository: string,
  entry: Entry,
  ownersByPath: ReadonlyMap<string, TaskRef[]>,
): Promise<Worktree> {
  const identity = await canonicalPath(entry.path)
  const matches = (ownersByPath.get(identity) ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    projectId: task.projectId,
  }))
  const base: Worktree = {
    ...entry,
    id: worktreeId(repository, identity),
    missing: entry.prunable,
    dirty: null,
    changedFiles: [],
    filesTruncated: false,
    lastCommit: null,
    owners: matches,
    error: null,
    observation: observation(repository, entry),
  }
  if (entry.prunable) return base
  try {
    const [status, log] = await Promise.all([
      core.git.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
        cwd: entry.path,
        maxOutputBytes: MAX_ROSTER_BYTES,
      }),
      core.git.git(['log', '-1', '--format=%ct%x00%s'], { cwd: entry.path, maxOutputBytes: 4096 }),
    ])
    if (status.code !== 0) return { ...base, error: message(status.stderr, 'Git status failed.') }
    const records = status.stdout.split('\0').filter(Boolean)
    const paths: string[] = []
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!
      if (record.length < 4) continue
      paths.push(record.slice(3))
      if (/[RC]/.test(record[0] ?? '') || /[RC]/.test(record[1] ?? '')) index++
    }
    const [seconds, subject] = log.code === 0 ? log.stdout.split('\0') : []
    return {
      ...base,
      dirty: records.length > 0,
      changedFiles: paths.slice(0, MAX_FILES),
      filesTruncated: paths.length > MAX_FILES,
      lastCommit:
        seconds && Number.isFinite(Number(seconds))
          ? { at: Number(seconds) * 1000, subject: subject?.trim() ?? '' }
          : null,
    }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}

async function taskOwners(core: Core, tasks: readonly TaskRef[]): Promise<Map<string, TaskRef[]>> {
  const owners = new Map<string, TaskRef[]>()
  const add = (path: string, task: TaskRef) => owners.set(path, [...(owners.get(path) ?? []), task])
  for (const task of tasks) {
    if (task.worktreePath) add(await canonicalPath(task.worktreePath), task)
  }
  // A project-folder task records no worktreePath. Its checkout is the mapped project's Git root,
  // and resolving it here makes the main (or a linked project mapping) show that task's ownership.
  const projectRoots = new Map<string, string | null>()
  for (const task of tasks) {
    if (task.branch !== null || task.worktreePath) continue
    if (!projectRoots.has(task.projectId)) {
      const project = await core.projects.byId(task.projectId)
      if (!project?.path) throw new Error('Cannot verify task checkout ownership.')
      const root = await core.git.git(['rev-parse', '--show-toplevel'], { cwd: project.path, maxOutputBytes: 8192 })
      // A folder outside any Git repository is in no roster, so its tasks own nothing. Any other
      // failure still refuses, because a missed owner would let cleanup remove a task's checkout.
      if (root.code === 128 && /not a git repository/i.test(root.stderr)) {
        projectRoots.set(task.projectId, null)
        continue
      }
      if (root.code !== 0 || root.truncated) throw new Error('Cannot verify task checkout ownership.')
      const path = await canonicalPath(root.stdout.trim())
      projectRoots.set(task.projectId, path)
    }
    const path = projectRoots.get(task.projectId)
    if (path) add(path, task)
  }
  return owners
}

export async function inventory(core: Core, projectId: string): Promise<WorktreeInventory> {
  const empty = (error: string): WorktreeInventory => ({
    projectId,
    repository: null,
    worktrees: [],
    error,
    observedAt: Date.now(),
  })
  const project = await core.projects.byId(projectId)
  if (!project) return empty('Project not found on this Node.')
  if (!project.path) return empty('This project has no mapped checkout on this Node.')
  const root = await core.git.git(['rev-parse', '--show-toplevel'], { cwd: project.path, maxOutputBytes: 8192 })
  if (root.code !== 0 || root.truncated)
    return empty(message(root.stderr, 'This project is not a complete Git repository.'))
  const checkoutRoot = await canonicalPath(root.stdout.trim())
  const roster = await core.git.git(['worktree', 'list', '--porcelain', '-z'], {
    cwd: checkoutRoot,
    maxOutputBytes: MAX_ROSTER_BYTES,
  })
  if (roster.code !== 0 || roster.truncated || !roster.stdout.endsWith('\0\0'))
    return { ...empty(message(roster.stderr, 'Could not read complete worktrees.')), repository: checkoutRoot }
  const entries = parseRoster(roster.stdout)
  // Git lists the main worktree first. Use that path as the repository identity so two project
  // mappings into different linked worktrees still share observations and the cleanup guard.
  const repository = await canonicalPath(entries[0]?.path ?? checkoutRoot)
  let owners: Map<string, TaskRef[]>
  try {
    owners = await taskOwners(core, await core.tasks.branchClaims())
  } catch {
    return { ...empty('Cannot verify task checkout ownership.'), repository }
  }
  const worktrees: Worktree[] = []
  for (let index = 0; index < entries.length; index += 8) {
    worktrees.push(
      ...(await Promise.all(entries.slice(index, index + 8).map((entry) => describe(core, repository, entry, owners)))),
    )
  }
  return { projectId, repository, worktrees, error: null, observedAt: Date.now() }
}
