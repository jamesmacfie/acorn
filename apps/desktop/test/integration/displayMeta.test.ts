import { describe, expect, it } from 'vitest'
import { fileStatusMeta, summarizeFileStats } from '@acorn/client-core/kit/lib'
import { routeKey } from '@acorn/plugin-github/testkit/client'

describe('fileStatusMeta', () => {
  it('maps common GitHub file statuses to compact letters', () => {
    expect(fileStatusMeta('added')).toEqual({ letter: 'A', label: 'Added', tone: 'ok' })
    expect(fileStatusMeta('removed')).toEqual({ letter: 'D', label: 'Deleted', tone: 'danger' })
    expect(fileStatusMeta('renamed')).toEqual({ letter: 'R', label: 'Renamed', tone: 'warn' })
    expect(fileStatusMeta('copied')).toEqual({ letter: 'C', label: 'Copied', tone: 'muted' })
  })

  it('defaults unknown or missing statuses to modified', () => {
    expect(fileStatusMeta(null)).toEqual({ letter: 'M', label: 'Modified', tone: 'warn' })
    expect(fileStatusMeta('something-new')).toEqual({ letter: 'M', label: 'Modified', tone: 'warn' })
  })
})

describe('summarizeFileStats', () => {
  it('counts files and totals additions/deletions', () => {
    expect(
      summarizeFileStats([
        { additions: 3, deletions: 1 },
        { additions: null, deletions: 4 },
      ]),
    ).toEqual({ count: 2, additions: 3, deletions: 5 })
  })
})

describe('routeKey', () => {
  it('scopes cross-pane file scroll requests to a PR route', () => {
    expect(routeKey('oak', 'oak', '482')).toBe('oak/oak#482')
  })
})
