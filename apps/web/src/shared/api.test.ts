import { describe, expect, it } from 'vitest'
import { apiRoutes, queryKeys } from './api'

describe('shared API contract helpers', () => {
  it('preserves route strings used by the client fetch layer', () => {
    expect(apiRoutes.me).toBe('/api/me')
    expect(apiRoutes.repos).toBe('/api/repos')
    expect(apiRoutes.reposRefresh).toBe('/api/repos/refresh')
    expect(apiRoutes.pulls('octo', 'repo', 'open')).toBe('/api/repos/octo/repo/pulls?state=open')
    expect(apiRoutes.pull('octo', 'repo', '12')).toBe('/api/repos/octo/repo/pulls/12')
    expect(apiRoutes.files('octo', 'repo', '12')).toBe('/api/repos/octo/repo/pulls/12/files')
    expect(apiRoutes.reviewReply('octo', 'repo', '12', 99)).toBe('/api/repos/octo/repo/pulls/12/review-comments/99/replies')
    expect(apiRoutes.resolveThread('octo', 'repo', '12', 'THREAD/id')).toBe('/api/repos/octo/repo/pulls/12/threads/THREAD%2Fid/resolve')
    expect(apiRoutes.rerunFailed('octo', 'repo', 123)).toBe('/api/repos/octo/repo/actions/123/rerun')
  })

  it('preserves query key shapes for cache compatibility', () => {
    expect(queryKeys.me).toEqual(['me'])
    expect(queryKeys.repos).toEqual(['repos'])
    expect(queryKeys.pulls('octo', 'repo', 'closed')).toEqual(['pulls', 'octo', 'repo', 'closed'])
    expect(queryKeys.pullsPrefix('octo', 'repo')).toEqual(['pulls', 'octo', 'repo'])
    expect(queryKeys.pull('octo', 'repo', '12')).toEqual(['pull', 'octo', 'repo', '12'])
    expect(queryKeys.pullPrefix('octo', 'repo')).toEqual(['pull', 'octo', 'repo'])
    expect(queryKeys.files('octo', 'repo', '12')).toEqual(['files', 'octo', 'repo', '12'])
    expect(queryKeys.pins).toEqual(['pins'])
    expect(queryKeys.prefs).toEqual(['prefs'])
  })
})
