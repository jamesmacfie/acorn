import { describe, expect, it } from 'vitest'
import * as api from './api'
import {
  corePluginBundleByHashRoute,
  integrationRoute,
  parseRailItemId,
  prefsKey,
  projectRoute,
  railItemId,
  scheduleConfirmRoute,
  taskContextRoute,
  taskRoute,
} from './api'

describe('shared API contract helpers', () => {
  // A net under the route literals in the subject modules: every one must land in a
  // current /v1 namespace (docs/api-reference/transport.md § Transport), because a path outside /v1/*
  // escapes the server's single auth and requireUser glob. Enumerated
  // from the module rather than listed, so a new builder is covered the day it lands.
  it('namespaces every exported route builder under /v1/core or /v1/p', () => {
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
      expect(path as string, name).toMatch(/^\/v1\/(core|p)\//)
    }
  })

  it('preserves query key shapes for cache compatibility', () => {
    expect(prefsKey).toEqual(['prefs'])
  })

  it('preserves route parameter encoding across contract owners', () => {
    expect(projectRoute('a/b')).toBe('/v1/core/projects/a%2Fb')
    expect(integrationRoute('a/b')).toBe('/v1/core/integrations/a/b')
    expect(taskRoute('a/b')).toBe('/v1/core/tasks/a/b')
    expect(corePluginBundleByHashRoute('a/b', 'c:d')).toBe('/v1/core/plugins/a%2Fb/bundles/c%3Ad')
    expect(scheduleConfirmRoute('a:b')).toBe('/v1/core/schedules/a%3Ab/confirm')
    expect(taskContextRoute('task', 'all')).toBe('/v1/core/tasks/task/context?include=*')
    expect(taskContextRoute('task', ['notes', 'links'])).toBe('/v1/core/tasks/task/context?include=notes,links')
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
