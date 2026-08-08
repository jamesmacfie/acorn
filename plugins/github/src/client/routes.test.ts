import { describe, expect, it } from 'vitest'
import { githubRouteContributions } from './routes'

describe('GitHub route contributions', () => {
  it('owns only the project-scoped PR surfaces', () => {
    expect(githubRouteContributions.map((route) => route.path)).toEqual([
      '/p/:projectId/pulls',
      '/p/:projectId/pulls/new',
      '/p/:projectId/pulls/:number',
    ])
    expect(githubRouteContributions.map((route) => route.order)).toEqual([30, 40, 50])
  })
})
