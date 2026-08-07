import { describe, expect, it } from 'vitest'
import * as api from './api'
import { prefsKey } from './api'

describe('shared API contract helpers', () => {
  // A net under the ~90 route literals above, which were namespaced by hand: every one of them must
  // land in a current /v2 namespace (docs/api-reference.md § HTTP conventions), because a path outside
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
    expect(paths.length).toBeGreaterThan(20) // guards against the filter silently matching nothing
    for (const [name, path] of paths) {
      expect(typeof path, name).toBe('string')
      expect(path as string, name).toMatch(/^\/v2\/(core|p)\//)
    }
  })

  it('preserves query key shapes for cache compatibility', () => {
    expect(prefsKey).toEqual(['prefs'])
  })
})
