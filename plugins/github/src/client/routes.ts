import type { SourceRouteContribution } from '@acorn/client-core/registries/sources.ts'

// GitHub owns only its optional PR browse surface. Core owns /p/:projectId and /p/:projectId/new.
export const githubRouteContributions: readonly SourceRouteContribution[] = [
  { id: 'github.browse', path: '/p/:projectId/pulls', kind: 'browse', order: 30 },
  { id: 'github.create', path: '/p/:projectId/pulls/new', kind: 'browse', order: 40 },
  { id: 'github.pull', path: '/p/:projectId/pulls/:number', kind: 'detail', order: 50 },
]

export const githubBrowseRoute = githubRouteContributions[0].path
export const githubCreateRoute = githubRouteContributions[1].path
export const githubPullRoute = githubRouteContributions[2].path
export const githubBrowsePath = (projectId: string) => `/p/${encodeURIComponent(projectId)}/pulls`
