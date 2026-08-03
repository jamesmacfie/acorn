import { describe, expect, it } from 'vitest'
import * as api from './api'
import {
  filePatchKey,
  filePatchRoute,
  filePatchesRoute,
  fileSummariesKey,
  fileSummariesRoute,
  filesKey,
  pullKey,
  pullPrefixKey,
  pullRoute,
  repoLabelsKey,
  repoLabelsRoute,
  closedPullsRoute,
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
  rollbarItemsForConnectionsRoute,
  rollbarItemsKey,
} from './api'

describe('shared API contract helpers', () => {
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
    expect(rollbarItemsForConnectionsRoute(['rollbar-b', 'rollbar-a', 'rollbar-b']))
      .toBe('/v2/p/rollbar/items?integrations=rollbar-a%2Crollbar-b')
  })

  // A net under the ~90 route literals above, which were namespaced by hand: every one of them must
  // land in a vNext namespace (docs/vNext/protocol.md § HTTP conventions), because a path outside
  // /v2/* escapes the server's single auth/requireUser glob and would 404 into the SPA shell.
  // Enumerated from the module rather than listed, so a new builder is covered the day it lands.
  it('namespaces every exported route builder under /v2/core or /v2/p', () => {
    // One dummy that satisfies every parameter shape the builders take: interpolates and
    // encodeURIComponent()s as 'x', spreads/joins as a one-element list, reads as truthy.
    const dummy = ['x']
    const paths = Object.entries(api)
      .filter(([name]) => name.endsWith('Route'))
      .map(([name, value]): [string, unknown] => [
        name,
        typeof value === 'function' ? (value as (...args: unknown[]) => unknown)(...Array.from({ length: value.length }, () => dummy)) : value,
      ])
    expect(paths.length).toBeGreaterThan(60) // guards against the filter silently matching nothing
    for (const [name, path] of paths) {
      expect(typeof path, name).toBe('string')
      expect(path as string, name).toMatch(/^\/v2\/(core|p)\//)
    }
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
    expect(prefsKey).toEqual(['prefs'])
    expect(rollbarItemsKey(['rollbar-b', 'rollbar-a', 'rollbar-b']))
      .toEqual(['rollbar-items', 'connections', 'rollbar-a', 'rollbar-b'])
  })
})
