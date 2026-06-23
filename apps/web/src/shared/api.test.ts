import { describe, expect, it } from 'vitest'
import {
  filesKey,
  meKey,
  meRoute,
  pullKey,
  pullPrefixKey,
  pullRoute,
  pullsKey,
  pullsPrefixKey,
  pullsRoute,
  repoRoute,
  reposKey,
  reposRefreshRoute,
  reposRoute,
  resolveThreadRoute,
  rerunFailedRoute,
  pinsKey,
  prefsKey,
} from './api'

describe('shared API contract helpers', () => {
  it('preserves route strings used by the client fetch layer', () => {
    expect(meRoute).toBe('/api/me')
    expect(reposRoute).toBe('/api/repos')
    expect(reposRefreshRoute).toBe('/api/repos/refresh')
    expect(repoRoute('octo', 'repo', 'actions/123/rerun')).toBe('/api/repos/octo/repo/actions/123/rerun')
    expect(pullsRoute('octo', 'repo', 'open')).toBe('/api/repos/octo/repo/pulls?state=open')
    expect(pullRoute('octo', 'repo', '12')).toBe('/api/repos/octo/repo/pulls/12')
    expect(pullRoute('octo', 'repo', '12', 'files')).toBe('/api/repos/octo/repo/pulls/12/files')
    expect(pullRoute('octo', 'repo', '12', 'review-comments/99/replies')).toBe('/api/repos/octo/repo/pulls/12/review-comments/99/replies')
    expect(resolveThreadRoute('octo', 'repo', '12', 'THREAD/id')).toBe('/api/repos/octo/repo/pulls/12/threads/THREAD%2Fid/resolve')
    expect(rerunFailedRoute('octo', 'repo', 123)).toBe('/api/repos/octo/repo/actions/123/rerun')
  })

  it('preserves query key shapes for cache compatibility', () => {
    expect(meKey).toEqual(['me'])
    expect(reposKey).toEqual(['repos'])
    expect(pullsKey('octo', 'repo', 'closed')).toEqual(['pulls', 'octo', 'repo', 'closed'])
    expect(pullsPrefixKey('octo', 'repo')).toEqual(['pulls', 'octo', 'repo'])
    expect(pullKey('octo', 'repo', '12')).toEqual(['pull', 'octo', 'repo', '12'])
    expect(pullPrefixKey('octo', 'repo')).toEqual(['pull', 'octo', 'repo'])
    expect(filesKey('octo', 'repo', '12')).toEqual(['files', 'octo', 'repo', '12'])
    expect(pinsKey).toEqual(['pins'])
    expect(prefsKey).toEqual(['prefs'])
  })
})
