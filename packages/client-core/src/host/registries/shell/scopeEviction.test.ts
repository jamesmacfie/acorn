import { afterEach, describe, expect, it } from 'vitest'
import { _resetScopeEvictors, evictScope, onScopeEvicted, scopeEvictorCount } from './scopeEviction'

afterEach(() => _resetScopeEvictors())

describe('scope eviction', () => {
  it('fans one eviction out to every registered owner', () => {
    const seen: string[] = []
    onScopeEvicted((e) => e.scope === 'task' && seen.push(`a:${e.taskId}`))
    onScopeEvicted((e) => e.scope === 'task' && seen.push(`b:${e.taskId}`))
    onScopeEvicted((e) => e.scope === 'workspace' && seen.push('never'))
    evictScope({ scope: 'task', taskId: 't1' })
    expect(seen).toEqual(['a:t1', 'b:t1'])
  })

  // The whole point of the mechanism is that a client is never left half-evicted, so one bad evictor
  // must not strand the others. This is the case the old hand-written call list could not survive.
  it('runs every evictor even when one throws', () => {
    const seen: string[] = []
    onScopeEvicted(() => { throw new Error('boom') })
    onScopeEvicted(() => seen.push('after'))
    expect(() => evictScope({ scope: 'node-switched' })).not.toThrow()
    expect(seen).toEqual(['after'])
  })

  it('stops calling an evictor once it unsubscribes', () => {
    const seen: string[] = []
    const off = onScopeEvicted(() => seen.push('x'))
    off()
    evictScope({ scope: 'node-switched' })
    expect(seen).toEqual([])
    expect(scopeEvictorCount()).toBe(0)
  })
})
