import { describe, expect, it } from 'vitest'
import * as api from './api'
import { rollbarItemsForConnectionsRoute, rollbarItemsKey } from './api'

// These two assertions moved here with the routes and keys they pin (from
// @acorn/protocol/src/api.test.ts). They are the only check that a template literal survived the move
// intact: a typo in a route string compiles fine and 404s at runtime, and a changed query key silently
// orphans a user's persisted IndexedDB cache, which has no buster.
describe('rollbar wire contract', () => {
  it('sorts and dedupes the connection set in the list route', () => {
    expect(rollbarItemsForConnectionsRoute(['rollbar-b', 'rollbar-a', 'rollbar-b']))
      .toBe('/v2/p/rollbar/items?integrations=rollbar-a%2Crollbar-b')
  })

  it('preserves the query key shape for cache compatibility', () => {
    expect(rollbarItemsKey(['rollbar-b', 'rollbar-a', 'rollbar-b']))
      .toEqual(['rollbar-items', 'connections', 'rollbar-a', 'rollbar-b'])
  })

  // The same net protocol's api.test.ts keeps over its own builders, now scoped to this plugin:
  // enumerated from the module rather than listed, so a new route is covered the day it lands. A path
  // outside /v2/p/rollbar/ escapes this plugin's mount and would 404 into the SPA shell.
  it('namespaces every exported route builder under its own plugin prefix', () => {
    const dummy = ['x']
    const paths = Object.entries(api)
      .filter(([name]) => name.endsWith('Route'))
      .map(([name, value]): [string, unknown] => [
        name,
        typeof value === 'function' ? (value as (...args: unknown[]) => unknown)(...Array.from({ length: value.length }, () => dummy)) : value,
      ])
    expect(paths.length).toBe(6) // guards against the filter silently matching nothing
    for (const [name, path] of paths) {
      expect(typeof path, name).toBe('string')
      expect(path as string, name).toMatch(/^\/v2\/p\/rollbar\//)
    }
  })
})
