import { describe, expect, it } from 'vitest'
import { linearIssuePath, linearRouteContributions } from './routes'

describe('Linear route contributions', () => {
  it('owns only the issue address, not the browse surface', () => {
    // No `/p/:projectId/issues` entry on purpose: the browse renders at core's project URL like every
    // other Source. A route addresses something inside a surface; it does not gate the surface.
    expect(linearRouteContributions.map((route) => route.path)).toEqual(['/p/:projectId/issues/:identifier'])
  })

  it('encodes both halves', () => {
    expect(linearIssuePath('project-web', 'ENG-404')).toBe('/p/project-web/issues/ENG-404')
    expect(linearIssuePath('project/web', 'ENG 1')).toBe('/p/project%2Fweb/issues/ENG%201')
  })
})
