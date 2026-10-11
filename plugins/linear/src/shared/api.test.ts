import { describe, expect, it } from 'vitest'
import * as api from './api'
import { linearProjectIssuesRoute } from './api'

// These pin what tsc can't see: a retyped route template compiles fine and 404s. There is no batch
// query key to pin here: the host owns one key for every provider's resolver, and client-core's
// `refResolvers` carries the persisted-cache warning that goes with it.
describe('linear wire contract', () => {
  it('sorts the id set in the project-issues route so cache identity is order-independent', () => {
    expect(linearProjectIssuesRoute('conn-1', ['p2', 'p1'])).toBe(
      '/v1/p/linear/project-issues?integration=conn-1&ids=p2%2Cp1',
    )
  })

  // The same net protocol's api.test.ts keeps over its own builders, scoped to this plugin: enumerated
  // from the module rather than listed, so a new route is covered the day it lands.
  it('namespaces every exported route builder under its own plugin prefix', () => {
    const dummy = ['x']
    const paths = Object.entries(api)
      .filter(([name]) => name.endsWith('Route'))
      .map(([name, value]): [string, unknown] => [
        name,
        typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown)(...Array.from({ length: value.length }, () => dummy))
          : value,
      ])
    expect(paths.length).toBe(5) // guards against the filter silently matching nothing
    for (const [name, path] of paths) {
      expect(typeof path, name).toBe('string')
      expect(path as string, name).toMatch(/^\/v1\/p\/linear\//)
    }
  })
})
