import { describe, expect, it } from 'vitest'
import { formatMergeRequestRef, parseMergeRequestRef, parseMergeRequestUrl, splitAddress } from './mergeRequestRef'

describe('merge request references', () => {
  it('spells a nested project on its server and its number, and reads it back', () => {
    const ref = formatMergeRequestRef('gitlab.com/group/sub/api', 12)
    expect(ref).toBe('gitlab.com/group/sub/api!12')
    expect(parseMergeRequestRef(ref)).toEqual({ address: 'gitlab.com/group/sub/api', number: '12' })
    expect(parseMergeRequestRef('gitlab.example.test/group/api!3')).toEqual({
      address: 'gitlab.example.test/group/api',
      number: '3',
    })
    expect(splitAddress('gitlab.example.test/group/sub/api')).toEqual({
      host: 'gitlab.example.test',
      path: 'group/sub/api',
    })
    // A path with no server, or a server with no group, isn't a project.
    expect(parseMergeRequestRef('group/api!12')).toBeNull()
    expect(parseMergeRequestRef('owner/repo#12')).toBeNull()
  })

  it('reads a merge request page on any server, at any group depth, with or without a tab', () => {
    expect(parseMergeRequestUrl('https://gitlab.com/group/sub/api/-/merge_requests/12')).toEqual({
      address: 'gitlab.com/group/sub/api',
      number: '12',
    })
    expect(parseMergeRequestUrl('https://gitlab.example.test/group/api/-/merge_requests/3')).toEqual({
      address: 'gitlab.example.test/group/api',
      number: '3',
    })
    expect(parseMergeRequestUrl('https://gitlab.com/group/api/-/merge_requests/7/diffs?view=inline#note_1')).toEqual({
      address: 'gitlab.com/group/api',
      number: '7',
    })
    expect(parseMergeRequestUrl('https://gitlab.com/group/api/-/issues/7')).toBeNull()
    expect(parseMergeRequestUrl('https://github.com/group/api/pull/7')).toBeNull()
    expect(parseMergeRequestUrl('http://gitlab.com/group/api/-/merge_requests/7')).toBeNull()
  })
})
