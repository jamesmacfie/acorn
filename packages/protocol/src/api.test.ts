import { describe, expect, it } from 'vitest'
import * as api from './api'
import { parseRailItemId, prefsKey, railItemId } from './api'

describe('shared API contract helpers', () => {
  // A net under the ~90 route literals above, which were namespaced by hand: every one must land in a
  // current /v2 namespace (docs/api-reference.md § HTTP conventions), because a path outside /v2/*
  // escapes the server's single auth and requireUser glob and would 404 into the SPA shell. Enumerated
  // from the module rather than listed, so a new builder is covered the day it lands.
  it('namespaces every exported route builder under /v2/core or /v2/p', () => {
    // One dummy that satisfies every parameter shape the builders take: it interpolates and
    // encodeURIComponent()s as 'x', spreads and joins as a one-element list, and reads as truthy.
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

  // The rail id is a round trip the plugin doesn't control, since the host hands the string back as a
  // frame's `context.item`, so the encoding is pinned here rather than only in the two plugins that put
  // their own names on the halves.
  it('round-trips a rail item id through a delimiter in either half', () => {
    expect(railItemId('rollbar:production', '142/7')).toBe('rollbar%3Aproduction:142%2F7')
    expect(parseRailItemId('rollbar%3Aproduction:142%2F7')).toEqual(['rollbar:production', '142/7'])
    expect(parseRailItemId('no-delimiter')).toBeNull()
    expect(parseRailItemId(':leading')).toBeNull()
    expect(parseRailItemId('trailing:')).toBeNull()
    expect(parseRailItemId('%broken:value')).toBeNull()
  })
})
