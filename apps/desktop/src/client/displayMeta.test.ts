import { describe, expect, it } from 'vitest'
import { fileStatusMeta, formatRelativeTime, githubAvatarUrl, summarizeFileStats } from './displayMeta'
import { routeKey } from './fileNavigation'

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 5, 23, 12)

  it('formats missing and current timestamps quietly', () => {
    expect(formatRelativeTime(null, now)).toBe('')
    expect(formatRelativeTime(now - 10_000, now)).toBe('now')
  })

  it('formats minutes, hours, days, and months', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatRelativeTime(now - 2 * 60 * 60_000, now)).toBe('2h ago')
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe('3d ago')
    expect(formatRelativeTime(now - 65 * 24 * 60 * 60_000, now)).toBe('2mo ago')
  })
})

describe('fileStatusMeta', () => {
  it('maps common GitHub file statuses to compact letters', () => {
    expect(fileStatusMeta('added')).toEqual({ letter: 'A', label: 'added', tone: 'add' })
    expect(fileStatusMeta('removed')).toEqual({ letter: 'D', label: 'deleted', tone: 'del' })
    expect(fileStatusMeta('renamed')).toEqual({ letter: 'R', label: 'renamed', tone: 'warn' })
    expect(fileStatusMeta('copied')).toEqual({ letter: 'C', label: 'copied', tone: 'muted' })
  })

  it('defaults unknown or missing statuses to modified', () => {
    expect(fileStatusMeta(null)).toEqual({ letter: 'M', label: 'modified', tone: 'warn' })
    expect(fileStatusMeta('something-new')).toEqual({ letter: 'M', label: 'modified', tone: 'warn' })
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

describe('githubAvatarUrl', () => {
  it('builds a deterministic GitHub avatar URL from a login', () => {
    expect(githubAvatarUrl('jamesmacfie', 36)).toBe('https://github.com/jamesmacfie.png?size=36')
    expect(githubAvatarUrl('space user', 18)).toBe('https://github.com/space%20user.png?size=18')
  })
})

describe('routeKey', () => {
  it('scopes cross-pane file scroll requests to a PR route', () => {
    expect(routeKey('oak', 'oak', '482')).toBe('oak/oak#482')
  })
})
