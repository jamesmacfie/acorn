import { describe, expect, it } from 'vitest'
import { hunkRows, hunkStart } from './hunk'

describe('hunkStart', () => {
  it('starts a hunk at its first new-side line', () => {
    expect(hunkStart('@@ -10,4 +12,6 @@ function a() {\n x')).toEqual({ line: 12, side: 'new' })
    expect(hunkStart('@@ -1 +1 @@\n-a\n+b')).toEqual({ line: 1, side: 'new' })
  })

  it('starts a hunk with no new side at its first old-side line', () => {
    expect(hunkStart('@@ -1,3 +0,0 @@\n-a\n-b\n-c')).toEqual({ line: 1, side: 'old' })
  })

  it('has no start for an item without hunk text', () => {
    expect(hunkStart('')).toBeNull()
  })
})

describe('hunkRows', () => {
  it('numbers each row on the sides it has', () => {
    expect(hunkRows('@@ -4,3 +4,3 @@ f()\n a\n-b\n+B\n c')).toEqual([
      { oldLine: 4, newLine: 4, text: 'a' },
      { oldLine: 5, newLine: null, text: 'b' },
      { oldLine: null, newLine: 5, text: 'B' },
      { oldLine: 6, newLine: 6, text: 'c' },
    ])
  })

  it('skips "No newline at end of file"', () => {
    expect(hunkRows('@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+y')).toEqual([
      { oldLine: 1, newLine: null, text: 'x' },
      { oldLine: null, newLine: 1, text: 'y' },
    ])
  })

  it('has no rows for an item without hunk text', () => {
    expect(hunkRows('')).toEqual([])
  })
})
