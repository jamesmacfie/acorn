import { describe, expect, it } from 'vitest'
import type { Pull } from '../../queries'
import { filterPulls } from './model'

const pull = (overrides: Partial<Pull>): Pull => ({
  number: 1,
  title: 'Build better lists',
  state: 'open',
  draft: false,
  author: 'octo',
  headRef: 'feature',
  baseRef: 'main',
  updatedAt: null,
  mergeable: null,
  mergeStateStatus: null,
  autoMergeEnabled: false,
  ...overrides,
})

describe('pull list model', () => {
  const pulls = [
    pull({ number: 12, title: 'Fix report totals', author: 'alice' }),
    pull({ number: 34, title: 'Refactor import flow', author: 'bob' }),
    pull({ number: 56, title: 'Chore dependency bumps', author: null }),
  ]

  it('returns the original list for an empty filter', () => {
    expect(filterPulls(pulls, '   ')).toBe(pulls)
  })

  it('filters by number, title, and author case-insensitively', () => {
    expect(filterPulls(pulls, '#12').map((p) => p.number)).toEqual([12])
    expect(filterPulls(pulls, 'IMPORT').map((p) => p.number)).toEqual([34])
    expect(filterPulls(pulls, 'alice').map((p) => p.number)).toEqual([12])
  })

  it('returns no rows for unmatched text', () => {
    expect(filterPulls(pulls, 'asjwjuwejd')).toEqual([])
  })
})
