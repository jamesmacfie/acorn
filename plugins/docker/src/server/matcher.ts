// Pure task↔container matcher. Primary signal: docker compose stamps every container with
// `com.docker.compose.project.working_dir`, and stacks launched from a task worktree carry the
// worktree path there (verified against runn-cli, which maps containers→worktrees the same way).
// Fallback: the branch slug embedded in container/project names (the ACORN_TASK_SLUG convention).
import type { DockerContainerSummary } from '../shared/model'
import { defaultOverrides, type DockerMatchOverrides } from './dockerConfig'

export type MatchableTask = { worktreePath: string | null; branch: string | null }
export type MatchableContainer = Pick<DockerContainerSummary, 'name' | 'composeProject' | 'composeWorkingDir' | 'labels'>

export const branchSlug = (branch: string): string => branch.replace(/[^A-Za-z0-9._-]/g, '-')

// Slugs shorter than this are too generic for substring matching ("main" would link everything).
const MIN_SLUG_LEN = 6

// These are daemon path strings, not paths to resolve on this Node's filesystem. Normalize both
// POSIX and Windows absolute paths, but refuse traversal rather than folding it into an association.
function absolutePath(path: string): string | null {
  if (!path) return null
  for (const char of path) if (char.charCodeAt(0) < 32) return null
  const windows = /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]/.test(path) || /^\/\/[^/]/.test(path)
  const value = windows ? path.replace(/\\/g, '/').toLowerCase() : path
  if (!windows && !value.startsWith('/')) return null
  const parts = value.split('/').filter(Boolean)
  if (parts.includes('..')) return null
  if (windows && (parts[0] === '?' || parts[0] === '.' || parts.some((p) => p !== '.' && /[. ]$/.test(p)))) return null
  const meaningful = parts.filter((p) => p !== '.')
  if (windows && value.startsWith('//')) {
    if (meaningful.length < 3 || meaningful.some((p) => p.includes(':'))) return null
    return `//${meaningful.join('/')}`
  }
  if (windows) return meaningful.length > 1 && meaningful.slice(1).every((p) => !p.includes(':')) ? meaningful.join('/') : null
  return meaningful.length ? `/${meaningful.join('/')}` : null
}

const isInside = (child: string, parent: string): boolean => {
  const c = absolutePath(child)
  const p = absolutePath(parent)
  return c !== null && p !== null && (c === p || c.startsWith(`${p}/`))
}

/** Only host-stored task roots and daemon working-directory metadata confer cleanup eligibility. */
export function containerBelongsToTask(container: MatchableContainer, task: MatchableTask): boolean {
  return !!task.worktreePath && !!container.composeWorkingDir && isInside(container.composeWorkingDir, task.worktreePath)
}

/** Display hints for the device-only task summary; never destructive authority. */
export function containerMatchesTask(container: MatchableContainer, task: MatchableTask, overrides: DockerMatchOverrides = defaultOverrides): boolean {
  // Explicit foreign/invalid metadata must not fall through to a matching name, label or project.
  if (container.composeWorkingDir !== null) return containerBelongsToTask(container, task)
  if (overrides.composeProject && container.composeProject === overrides.composeProject) return true
  if (!task.branch) return false
  const slug = branchSlug(task.branch)
  if (overrides.matchLabels.some((key) => container.labels[key] === slug)) return true
  if (!overrides.matchName) return false
  const lower = slug.toLowerCase()
  if (lower.length < MIN_SLUG_LEN) return false
  return container.name.toLowerCase().includes(lower) || (container.composeProject ?? '').toLowerCase().includes(lower)
}
