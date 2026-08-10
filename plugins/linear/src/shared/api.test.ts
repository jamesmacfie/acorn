import { describe, expect, it } from 'vitest'
import * as api from './api'
import { linearProjectIssuesRoute } from './api'

// Protocol's api.test.ts had no Linear cases, so these are new rather than moved. They pin what tsc
// cannot see: a retyped route template compiles fine and 404s.
//
// The batch query key that used to be pinned here is gone with `contract/issues.ts` — the host owns one
// key for every provider's resolver now, and client-core/registries/refResolvers.ts carries the
// persisted-cache warning that came with it.
describe('linear wire contract', () => {
  it('sorts the id set in the project-issues route so cache identity is order-independent', () => {
    expect(linearProjectIssuesRoute('conn-1', ['p2', 'p1']))
      .toBe('/v2/p/linear/project-issues?integration=conn-1&ids=p2%2Cp1')
  })

  // The same net protocol's api.test.ts keeps over its own builders, scoped to this plugin:
  // enumerated from the module rather than listed, so a new route is covered the day it lands.
  it('namespaces every exported route builder under its own plugin prefix', () => {
    const dummy = ['x']
    const paths = Object.entries(api)
      .filter(([name]) => name.endsWith('Route'))
      .map(([name, value]): [string, unknown] => [
        name,
        typeof value === 'function' ? (value as (...args: unknown[]) => unknown)(...Array.from({ length: value.length }, () => dummy)) : value,
      ])
    expect(paths.length).toBe(5) // guards against the filter silently matching nothing
    for (const [name, path] of paths) {
      expect(typeof path, name).toBe('string')
      expect(path as string, name).toMatch(/^\/v2\/p\/linear\//)
    }
  })
})
