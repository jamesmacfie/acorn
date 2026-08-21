import type { SourceRouteContribution } from '@acorn/plugin-api/client'

// GitHub owns only its optional PR browse surface. Core owns /p/:projectId and /p/:projectId/new.
//
// These address a pull request; they do not decide whether the browse renders
// (docs/plugins.md § Frame authoring and the UI kit). The bare `/pulls` entry is reachable only from
// history and remembered paths now that the surface renders at the project URL, and stays registered
// so those keep resolving.
export const githubRouteContributions: readonly SourceRouteContribution[] = [
  { id: 'github.browse', path: '/p/:projectId/pulls', order: 30 },
  { id: 'github.create', path: '/p/:projectId/pulls/new', order: 40 },
  { id: 'github.pull', path: '/p/:projectId/pulls/:number', order: 50 },
]

export const githubBrowseRoute = githubRouteContributions[0].path
export const githubCreateRoute = githubRouteContributions[1].path
export const githubPullRoute = githubRouteContributions[2].path
export const githubBrowsePath = (projectId: string) => `/p/${encodeURIComponent(projectId)}/pulls`
