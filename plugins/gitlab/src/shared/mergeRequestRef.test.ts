import { describe, expect, it } from 'vitest'
import { formatMergeRequestRef, parseMergeRequestRef, parseMergeRequestUrl } from './mergeRequestRef'

describe('merge request references', () => {
  it('spells a nested project and its number, and reads it back', () => {
    const ref = formatMergeRequestRef('group/sub/api', 12)
    expect(ref).toBe('group/sub/api!12')
    expect(parseMergeRequestRef(ref)).toEqual({ path: 'group/sub/api', number: '12' })
    expect(parseMergeRequestRef('api!12')).toBeNull()
    expect(parseMergeRequestRef('owner/repo#12')).toBeNull()
  })

  it('reads a merge request page at any group depth, with or without a tab', () => {
    expect(parseMergeRequestUrl('https://gitlab.com/group/sub/api/-/merge_requests/12')).toEqual({
      path: 'group/sub/api',
      number: '12',
    })
    expect(parseMergeRequestUrl('https://gitlab.com/group/api/-/merge_requests/7/diffs?view=inline#note_1')).toEqual({
      path: 'group/api',
      number: '7',
    })
    expect(parseMergeRequestUrl('https://gitlab.com/group/api/-/issues/7')).toBeNull()
    expect(parseMergeRequestUrl('https://github.com/group/api/pull/7')).toBeNull()
  })
})
