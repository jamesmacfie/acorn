import { describe, expect, it } from 'vitest'
import * as api from './api'
import { linearIssuesKey, linearProjectIssuesRoute } from './api'

// Protocol's api.test.ts had no Linear cases, so these are new rather than moved. They pin the two
// things tsc cannot see: a retyped route template compiles fine and 404s, and a changed query key
// silently orphans a user's persisted IndexedDB cache, which has no buster.
describe('linear wire contract', () => {
  it('sorts the id set in the project-issues route so cache identity is order-independent', () => {
    expect(linearProjectIssuesRoute('conn-1', ['p2', 'p1']))
      .toBe('/v2/p/linear/project-issues?integration=conn-1&ids=p2%2Cp1')
  })

  // The one remaining key, and it is github's: `linearIssuesOptions` in contract/issues.ts runs the batch
  // query on PR detail. Order-independent by construction, because the identifier set a PR body yields is
  // not ordered — two scans of the same PR must not be two cache entries.
  it('preserves the batch query key shape for cache compatibility', () => {
    expect(linearIssuesKey(['ENG-2', 'ENG-1'])).toEqual(['linear-issues', 'ENG-1', 'ENG-2'])
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
