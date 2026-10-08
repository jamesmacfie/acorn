import { lazy } from 'solid-js'
import type { SourceContribution } from '@acorn/plugin-api/client'

const WorktreeList = lazy(() => import('./WorktreeBrowse').then((module) => ({ default: module.WorktreeList })))
const WorktreeDetail = lazy(() => import('./WorktreeBrowse').then((module) => ({ default: module.WorktreeDetail })))

export const gitSourceContribution: SourceContribution<never> = {
  id: 'git', order: 45, glyph: 'git-branch', label: 'Git',
  projectScoped: true, requiresGitProject: true,
  routes: [
    { id: 'git.worktrees', path: '/p/:projectId/x/git/worktrees', order: 40 },
    { id: 'git.worktree', path: '/p/:projectId/x/git/worktrees/:worktreeId', order: 41 },
  ],
  regions: { list: WorktreeList, detail: WorktreeDetail, scroll: true },
}
