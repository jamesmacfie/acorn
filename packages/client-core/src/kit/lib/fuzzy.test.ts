import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('scores a contiguous run above a scattered one', () => {
    expect(fuzzyScore('dev', 'dev')!).toBeGreaterThan(fuzzyScore('dev', 'd-e-v')!)
  })

  it('rewards a word start', () => {
    expect(fuzzyScore('t', 'New terminal')!).toBeGreaterThan(fuzzyScore('t', 'attention')!)
  })

  it('rejects a non-subsequence', () => {
    expect(fuzzyScore('abc', 'a-b')).toBeNull()
  })

  it('matches everything on an empty query, so the caller keeps its own order', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})
