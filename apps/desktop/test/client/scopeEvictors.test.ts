import { describe, expect, it } from 'vitest'
import { scopeEvictorCount } from '@acorn/client-core/registries/scopeEviction.ts'

// An empty registry would make every eviction silently do nothing, which is precisely the bug class
// this mechanism replaced, so the one thing worth asserting at the app level is that booting the
// client graph actually populates it.
//
// A count rather than a list: which owners register is a property of what has been imported, and the
// lazy panes register only once they load. Pinning names here would fail for the right code every time
// a pane became lazier.
describe('scope evictors after the client graph boots', () => {
  it('are registered', async () => {
    await import('../../src/app/client/activate')
    expect(scopeEvictorCount()).toBeGreaterThan(0)
  })
})
