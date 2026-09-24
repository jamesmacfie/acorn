import { describe, expect, it } from 'vitest'
import { changedLineRanges, translateLineRanges, unifiedDiffHunks } from './lineMarkers'

describe('editor line marker diff coordinates', () => {
  it('reads omitted counts, additions, replacements, and pure deletions', () => {
    const patch = [
      '@@ -2 +2,2 @@',
      '@@ -8,3 +9 @@',
      '@@ -20,2 +20,0 @@',
    ].join('\n')
    expect(unifiedDiffHunks(patch)).toEqual([
      { oldStart: 2, oldLines: 1, newStart: 2, newLines: 2 },
      { oldStart: 8, oldLines: 3, newStart: 9, newLines: 1 },
      { oldStart: 20, oldLines: 2, newStart: 20, newLines: 0 },
    ])
    expect(changedLineRanges(patch)).toEqual([{ from: 2, to: 3 }, { from: 9, to: 9 }])
  })

  it('keeps PR ranges attached through local insertions, replacements, and deletions', () => {
    const localPatch = [
      '@@ -2,0 +3,2 @@', // insert after HEAD line 2
      '@@ -5,2 +7,3 @@', // replace marked HEAD line 6
      '@@ -10,1 +12,0 @@', // delete marked HEAD line 10
    ].join('\n')
    expect(translateLineRanges([
      { from: 1, to: 3 },
      { from: 6, to: 6 },
      { from: 9, to: 10 },
      { from: 12, to: 12 },
    ], localPatch)).toEqual([
      { from: 1, to: 2 },
      { from: 5, to: 5 },
      { from: 7, to: 9 },
      { from: 12, to: 12 },
      { from: 14, to: 14 },
    ])
  })
})
