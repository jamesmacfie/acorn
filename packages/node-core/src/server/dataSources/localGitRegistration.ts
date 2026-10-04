import { registerCoreDataSource } from './registry'

// The catalog is available at boot; Git reads load only when a source is queried.
registerCoreDataSource({ sourceId: 'local-branches', name: 'Local branches', singular: 'Branch', plural: 'Branches',
  identityScope: 'Project and local Git ref name', titlePointer: '/name', icon: 'git-branch' },
async (request, env) => (await import('./localGitSources')).localBranches(request, env))
registerCoreDataSource({ sourceId: 'local-worktrees', name: 'Local worktrees', singular: 'Worktree', plural: 'Worktrees',
  identityScope: 'Project and absolute worktree path', titlePointer: '/path', icon: 'folder-git-2' },
async (request, env) => (await import('./localGitSources')).localWorktrees(request, env))
