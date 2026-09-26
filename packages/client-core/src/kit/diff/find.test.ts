import { describe, expect, it } from 'vitest'
import { markTokens } from './find'

describe('markTokens', () => {
  it('splits tokens across a match spanning two tokens and preserves extra props', () => {
    const toks = [
      { content: 'foo', c: 'red' },
      { content: 'bar', c: 'blue' },
    ]
    const segs = markTokens(toks, [[2, 4]], [2, 4])
    expect(segs.map((s) => [s.content, s.mark, s.c])).toEqual([
      ['fo', 0, 'red'],
      ['o', 2, 'red'],
      ['b', 2, 'blue'],
      ['ar', 0, 'blue'],
    ])
    // reassembles to the original text
    expect(segs.map((s) => s.content).join('')).toBe('foobar')
  })
})
