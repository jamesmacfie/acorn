import { describe, expect, it } from 'vitest'
import { collectMatches, markTokens } from './find'
import type { CodeRow, Row } from './model'

const code = (raw: string): CodeRow => ({ kind: 'normal', path: 'a', oldNo: 1, newNo: 1, toks: [], raw })

describe('collectMatches', () => {
  it('finds every occurrence, case-insensitive by default', () => {
    const rows: Row[] = [code('foo Foo'), { kind: 'hunk', text: 'foo' }, code('bar')]
    const m = collectMatches(rows, 'foo', false)
    expect(m.map((x) => [x.rowIndex, x.start, x.end])).toEqual([
      [0, 0, 3],
      [0, 4, 7],
    ]) // hunk row is not searched
  })
  it('respects case sensitivity', () => {
    expect(collectMatches([code('foo Foo')], 'Foo', true)).toHaveLength(1)
  })
})

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
