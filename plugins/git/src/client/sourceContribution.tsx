import { lazy } from 'solid-js'
import type { SourceContribution } from '@acorn/plugin-api/client'

const GitSourceList = lazy(() => import('./HistoryBrowse').then((module) => ({ default: module.GitSourceList })))
const GitSourceDetail = lazy(() => import('./HistoryBrowse').then((module) => ({ default: module.GitSourceDetail })))

export const gitSourceContribution: SourceContribution<never> = {
  id: 'git', order: 45, glyph: 'git-branch', label: 'Git',
  projectScoped: true, requiresGitProject: true,
  routes: [
    { id: 'git.history', path: '/p/:projectId/x/git/history', order: 30 },
    { id: 'git.revision', path: '/p/:projectId/x/git/history/:commitId', order: 31 },
    { id: 'git.stashes', path: '/p/:projectId/x/git/stashes', order: 35 },
    { id: 'git.stash', path: '/p/:projectId/x/git/stashes/:stashId', order: 36 },
    { id: 'git.worktrees', path: '/p/:projectId/x/git/worktrees', order: 40 },
    { id: 'git.worktree', path: '/p/:projectId/x/git/worktrees/:worktreeId', order: 41 },
  ],
  regions: { list: GitSourceList, detail: GitSourceDetail, scroll: true },
}
