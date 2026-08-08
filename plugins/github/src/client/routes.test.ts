import { describe, expect, it } from 'vitest'
import { githubRouteContributions } from './routes'

describe('GitHub route compatibility', () => {
  it('keeps the existing deep-link shapes and static-before-parameter order', () => {
    expect(githubRouteContributions.map((route) => route.path)).toEqual([
      '/:owner/:repo',
      '/:owner/:repo/new',
      '/:owner/:repo/:number',
    ])
    expect(githubRouteContributions.map((route) => route.order)).toEqual([10, 20, 30])
  })
})
