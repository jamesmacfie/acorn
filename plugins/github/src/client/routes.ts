import type { SourceRouteContribution } from '@acorn/client-core/registries/sources.ts'

// Existing URL shapes are persisted in browser history and shared links. The explicit order keeps
// the static create route ahead of the parameter route when both could match the same segment count.
export const githubRouteContributions: readonly SourceRouteContribution[] = [
  { id: 'github.repo', path: '/:owner/:repo', kind: 'repo', order: 10 },
  { id: 'github.create', path: '/:owner/:repo/new', kind: 'create', order: 20 },
  { id: 'github.pull', path: '/:owner/:repo/:number', kind: 'detail', order: 30 },
]

export const githubCreateRoute = githubRouteContributions[1].path
