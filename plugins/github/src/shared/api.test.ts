import { describe, expect, it } from 'vitest'
import * as api from './api'
import {
  closedPullsRoute,
  fileSummariesKey,
  fileSummariesRoute,
  pullDiffKey,
  pullDiffRoute,
  diffSegmentsRoute,
  diffSearchRoute,
  pinsKey,
  pullKey,
  pullPrefixKey,
  pullRoute,
  pullsKey,
  pullsPrefixKey,
  pullsRoute,
  repoLabelsKey,
  repoLabelsRoute,
  repoRoute,
  reposKey,
  reposRefreshRoute,
  reposRoute,
  rerunFailedRoute,
  resolveThreadRoute,
} from './api'

// These assertions stay beside the GitHub routes and keys. TypeScript cannot catch a mistyped route
// that returns 404 or a changed query key that orphans a persisted IndexedDB cache.
describe('github wire contract', () => {
  it('preserves route strings used by the client fetch layer', () => {
    expect(reposRoute).toBe('/v1/p/github/repos')
    expect(reposRefreshRoute).toBe('/v1/p/github/repos/refresh')
    expect(repoRoute('octo', 'repo', 'actions/123/rerun')).toBe('/v1/p/github/repos/octo/repo/actions/123/rerun')
    expect(pullsRoute('octo', 'repo', 'open')).toBe('/v1/p/github/repos/octo/repo/pulls?state=open')
    expect(closedPullsRoute('octo', 'repo', 2)).toBe('/v1/p/github/repos/octo/repo/pulls?state=closed&page=2')
    expect(repoLabelsRoute('octo', 'repo')).toBe('/v1/p/github/repos/octo/repo/labels')
    expect(pullRoute('octo', 'repo', '12')).toBe('/v1/p/github/repos/octo/repo/pulls/12')
    expect(pullRoute('octo', 'repo', '12', 'files')).toBe('/v1/p/github/repos/octo/repo/pulls/12/files')
    expect(fileSummariesRoute('octo', 'repo', '12')).toBe('/v1/p/github/repos/octo/repo/pulls/12/files?summary=1')
    expect(pullDiffRoute('octo', 'repo', '12')).toBe('/v1/p/github/repos/octo/repo/pulls/12/diff')
    expect(diffSegmentsRoute('octo', 'repo')).toBe('/v1/p/github/repos/octo/repo/diff/segments')
    expect(diffSearchRoute('octo', 'repo')).toBe('/v1/p/github/repos/octo/repo/diff/search')
    expect(pullRoute('octo', 'repo', '12', 'review-comments/99/replies'))
      .toBe('/v1/p/github/repos/octo/repo/pulls/12/review-comments/99/replies')
    expect(resolveThreadRoute('octo', 'repo', '12', 'THREAD/id')).toBe('/v1/p/github/repos/octo/repo/pulls/12/threads/THREAD%2Fid/resolve')
    expect(rerunFailedRoute('octo', 'repo', 123)).toBe('/v1/p/github/repos/octo/repo/actions/123/rerun')
  })

  it('preserves query key shapes for cache compatibility', () => {
    expect(reposKey).toEqual(['repos'])
    expect(pullsKey('octo', 'repo', 'closed')).toEqual(['pulls', 'octo', 'repo', 'closed'])
    expect(pullsPrefixKey('octo', 'repo')).toEqual(['pulls', 'octo', 'repo'])
    expect(pullKey('octo', 'repo', '12')).toEqual(['pull', 'octo', 'repo', '12'])
    expect(pullPrefixKey('octo', 'repo')).toEqual(['pull', 'octo', 'repo'])
    expect(repoLabelsKey('octo', 'repo')).toEqual(['labels', 'octo', 'repo'])
    expect(fileSummariesKey('octo', 'repo', '12')).toEqual(['files', 'octo', 'repo', '12', 'summary', 'v2'])
    expect(pullDiffKey('octo', 'repo', '12')).toEqual(['files', 'octo', 'repo', '12', 'diff'])
    expect(pinsKey).toEqual(['pins'])
  })

  // The same net protocol keeps over its own builders, scoped to this plugin: enumerated from the
  // module rather than listed, so a new route is covered the day it lands. A path outside
  // /v1/p/github/ escapes this plugin's mount and would 404 into the SPA shell.
  it('namespaces every exported route builder under its own plugin prefix', () => {
    const dummy = ['x']
    const paths = Object.entries(api)
      .filter(([name]) => name.endsWith('Route'))
      .map(([name, value]): [string, unknown] => [
        name,
        typeof value === 'function' ? (value as (...args: unknown[]) => unknown)(...Array.from({ length: value.length }, () => dummy)) : value,
      ])
    expect(paths.length).toBeGreaterThan(20) // guards against the filter silently matching nothing
    for (const [name, path] of paths) {
      expect(typeof path, name).toBe('string')
      expect(path as string, name).toMatch(/^\/v1\/p\/github\//)
    }
  })
})
