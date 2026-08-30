import { describe, expect, it } from 'vitest'
import * as api from './api'
import {
  closedPullsRoute,
  filePatchKey,
  filePatchRoute,
  filePatchesRoute,
  fileSummariesKey,
  fileSummariesRoute,
  filesKey,
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

// Moved here from @acorn/protocol/src/api.test.ts with the routes and keys it pins. These two things
// are invisible to tsc and expensive to get wrong: a retyped route template compiles fine and 404s at
// runtime, and a changed query key silently orphans a user's persisted IndexedDB cache, which has no
// buster.
describe('github wire contract', () => {
  it('preserves route strings used by the client fetch layer', () => {
    expect(reposRoute).toBe('/v2/p/github/repos')
    expect(reposRefreshRoute).toBe('/v2/p/github/repos/refresh')
    expect(repoRoute('octo', 'repo', 'actions/123/rerun')).toBe('/v2/p/github/repos/octo/repo/actions/123/rerun')
    expect(pullsRoute('octo', 'repo', 'open')).toBe('/v2/p/github/repos/octo/repo/pulls?state=open')
    expect(closedPullsRoute('octo', 'repo', 2)).toBe('/v2/p/github/repos/octo/repo/pulls?state=closed&page=2')
    expect(repoLabelsRoute('octo', 'repo')).toBe('/v2/p/github/repos/octo/repo/labels')
    expect(pullRoute('octo', 'repo', '12')).toBe('/v2/p/github/repos/octo/repo/pulls/12')
    expect(pullRoute('octo', 'repo', '12', 'files')).toBe('/v2/p/github/repos/octo/repo/pulls/12/files')
    expect(fileSummariesRoute('octo', 'repo', '12')).toBe('/v2/p/github/repos/octo/repo/pulls/12/files?summary=1')
    expect(filePatchRoute('octo', 'repo', '12', 'src/app file.ts')).toBe('/v2/p/github/repos/octo/repo/pulls/12/files?path=src%2Fapp%20file.ts')
    expect(filePatchesRoute('octo', 'repo', '12')).toBe('/v2/p/github/repos/octo/repo/pulls/12/files/patches')
    expect(pullRoute('octo', 'repo', '12', 'review-comments/99/replies'))
      .toBe('/v2/p/github/repos/octo/repo/pulls/12/review-comments/99/replies')
    expect(resolveThreadRoute('octo', 'repo', '12', 'THREAD/id')).toBe('/v2/p/github/repos/octo/repo/pulls/12/threads/THREAD%2Fid/resolve')
    expect(rerunFailedRoute('octo', 'repo', 123)).toBe('/v2/p/github/repos/octo/repo/actions/123/rerun')
  })

  it('preserves query key shapes for cache compatibility', () => {
    expect(reposKey).toEqual(['repos'])
    expect(pullsKey('octo', 'repo', 'closed')).toEqual(['pulls', 'octo', 'repo', 'closed'])
    expect(pullsPrefixKey('octo', 'repo')).toEqual(['pulls', 'octo', 'repo'])
    expect(pullKey('octo', 'repo', '12')).toEqual(['pull', 'octo', 'repo', '12'])
    expect(pullPrefixKey('octo', 'repo')).toEqual(['pull', 'octo', 'repo'])
    expect(repoLabelsKey('octo', 'repo')).toEqual(['labels', 'octo', 'repo'])
    expect(filesKey('octo', 'repo', '12')).toEqual(['files', 'octo', 'repo', '12'])
    expect(fileSummariesKey('octo', 'repo', '12')).toEqual(['files', 'octo', 'repo', '12', 'summary'])
    expect(filePatchKey('octo', 'repo', '12', 'src/app.ts')).toEqual(['files', 'octo', 'repo', '12', 'patch', 'src/app.ts'])
    expect(pinsKey).toEqual(['pins'])
  })

  // The same net protocol keeps over its own builders, scoped to this plugin: enumerated from the
  // module rather than listed, so a new route is covered the day it lands. A path outside
  // /v2/p/github/ escapes this plugin's mount and would 404 into the SPA shell.
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
      expect(path as string, name).toMatch(/^\/v2\/p\/github\//)
    }
  })
})
