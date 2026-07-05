import { describe, expect, it } from 'vitest'
import { chunkRowsByColumnBudget } from './batch'
import { filesResource, prResource, pullsResource } from './resourceKeys'

describe('server db helpers', () => {
  it('builds stable sync resource keys', () => {
    expect(pullsResource(42, 'open')).toBe('pulls:42:open')
    expect(pullsResource(42, 'closed')).toBe('pulls:42:closed')
    expect(prResource(42, 7)).toBe('pr:42:7')
    expect(filesResource(42, 7)).toBe('files:42:7')
  })

  it('chunks rows by the bound-parameter budget', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      c1: i,
      c2: i,
      c3: i,
      c4: i,
      c5: i,
      c6: i,
      c7: i,
      c8: i,
      c9: i,
      c10: i,
      c11: i,
      c12: i,
      c13: i,
      c14: i,
    }))

    const chunks = chunkRowsByColumnBudget(rows)

    expect(chunks.map((chunk) => chunk.length)).toEqual([7, 7, 1])
    expect(chunks.every((chunk) => chunk.length * Object.keys(chunk[0]!).length <= 100)).toBe(true)
  })

  it('keeps empty chunks empty and single wide rows valid', () => {
    expect(chunkRowsByColumnBudget([])).toEqual([])
    expect(chunkRowsByColumnBudget([{ a: 1, b: 2, c: 3 }], 2)).toEqual([[{ a: 1, b: 2, c: 3 }]])
  })
})
