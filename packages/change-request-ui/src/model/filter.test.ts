import { describe, expect, it } from 'vitest'
import type { ChangeRequestSummary } from './types'
import { filterChangeRequests } from './filter'

const pull = (overrides: Partial<ChangeRequestSummary>): ChangeRequestSummary => ({
  number: 1,
  title: 'Build better lists',
  state: 'open',
  draft: false,
  author: 'octo',
  headRef: 'feature',
  baseRef: 'main',
  updatedAt: null,
  ...overrides,
})

describe('change request list filter', () => {
  const pulls = [
    pull({ number: 12, title: 'Fix report totals', author: 'alice' }),
    pull({ number: 34, title: 'Refactor import flow', author: 'bob', headRef: 'bob/import-flow' }),
    pull({ number: 56, title: 'Chore dependency bumps', author: null }),
  ]

  it('returns the original list for an empty filter', () => {
    expect(filterChangeRequests(pulls, '   ', '#')).toBe(pulls)
  })

  it('filters by number, title, author, and branch case-insensitively', () => {
    expect(filterChangeRequests(pulls, '#12', '#').map((p) => p.number)).toEqual([12])
    expect(filterChangeRequests(pulls, 'IMPORT', '#').map((p) => p.number)).toEqual([34])
    expect(filterChangeRequests(pulls, 'alice', '#').map((p) => p.number)).toEqual([12])
    expect(filterChangeRequests(pulls, 'bob/import-flow', '#').map((p) => p.number)).toEqual([34])
  })

  it("matches a number with the host's own prefix", () => {
    expect(filterChangeRequests(pulls, '!34', '!').map((p) => p.number)).toEqual([34])
    expect(filterChangeRequests(pulls, '#34', '!')).toEqual([])
  })

  it('returns no rows for unmatched text', () => {
    expect(filterChangeRequests(pulls, 'asjwjuwejd', '#')).toEqual([])
  })
})
