// Pure task↔container matcher. Primary signal: docker compose stamps every container with
// `com.docker.compose.project.working_dir`, and stacks launched from a task worktree carry the
// worktree path there (verified against runn-cli, which maps containers→worktrees the same way).
// Fallback: the branch slug embedded in container/project names (the ACORN_TASK_SLUG convention).
import type { DockerContainerSummary } from '../shared/model'
import { defaultOverrides, type DockerMatchOverrides } from './dockerConfig'

export type MatchableTask = { worktreePath: string | null; branch: string }
export type MatchableContainer = Pick<DockerContainerSummary, 'name' | 'composeProject' | 'composeWorkingDir' | 'labels'>

// ponytail: duplicated one-liner — keep in sync with plugins/terminal/main/terminalUtils.ts
// branchSlug (frozen plugin boundary; it's the documented isolation handle for compose -p).
export const branchSlug = (branch: string): string => branch.replace(/[^A-Za-z0-9._-]/g, '-')

// Slugs shorter than this are too generic for substring matching ("main" would link everything).
const MIN_SLUG_LEN = 6

const normalize = (p: string): string => p.replace(/\/+$/, '')

const isInside = (child: string, parent: string): boolean => {
  const c = normalize(child)
  const p = normalize(parent)
  return c === p || c.startsWith(`${p}/`)
}

export function containerMatchesTask(container: MatchableContainer, task: MatchableTask, overrides: DockerMatchOverrides = defaultOverrides): boolean {
  if (task.worktreePath && container.composeWorkingDir && isInside(container.composeWorkingDir, task.worktreePath)) return true
  if (overrides.composeProject && container.composeProject === overrides.composeProject) return true
  const slug = branchSlug(task.branch)
  if (overrides.matchLabels.some((key) => container.labels[key] === slug)) return true
  if (!overrides.matchName) return false
  const lower = slug.toLowerCase()
  if (lower.length < MIN_SLUG_LEN) return false
  return container.name.toLowerCase().includes(lower) || (container.composeProject ?? '').toLowerCase().includes(lower)
}
