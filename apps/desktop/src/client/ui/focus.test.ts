import { describe, expect, it } from 'vitest'
import { nextListIndex } from './focus'

describe('nextListIndex', () => {
  it('wraps arrows and j/k and supports boundaries', () => {
    expect(nextListIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(nextListIndex(0, 3, 'k')).toBe(2)
    expect(nextListIndex(1, 3, 'Home')).toBe(0)
    expect(nextListIndex(1, 3, 'End')).toBe(2)
  })
})
