import { describe, expect, it } from 'vitest'
import type { RollbarItemSummary } from '../../../core/shared/api'
import { emptyRollbarFilter, filterRollbarItems, rollbarFacets, sortRollbarItems } from './model'

const item = (over: Partial<RollbarItemSummary>): RollbarItemSummary => ({
  integrationId: 'c1', integrationLabel: 'Rollbar · api', identifier: '1', itemId: 'i1', title: 'boom',
  url: 'https://rollbar.com/item/i1/',
  level: 'error', environment: 'prod', status: 'active', totalOccurrences: 1, firstOccurrenceAt: null, lastOccurrenceAt: null,
  ...over,
})

describe('rollbar client model', () => {
  const items = [
    item({ integrationId: 'c1', identifier: '142', title: 'TypeError token', level: 'error', environment: 'prod', lastOccurrenceAt: 300 }),
    item({ integrationId: 'c1', identifier: '118', title: 'Timeout', level: 'warning', environment: 'prod', lastOccurrenceAt: 200 }),
    item({ integrationId: 'c2', identifier: '142', title: 'Other project', level: 'error', environment: 'stage', lastOccurrenceAt: null }),
  ]

  it('sorts by last occurrence desc, nulls last', () => {
    expect(sortRollbarItems(items).map((i) => i.identifier)).toEqual(['142', '118', '142'])
    expect(sortRollbarItems(items)[2].integrationId).toBe('c2')
  })

  it('case-insensitive title search', () => {
    expect(filterRollbarItems(items, { ...emptyRollbarFilter, search: 'timeout' }).map((i) => i.title)).toEqual(['Timeout'])
  })

  it('counter search tolerates the # prefix and stays scoped by other filters', () => {
    expect(filterRollbarItems(items, { ...emptyRollbarFilter, search: '#142' })).toHaveLength(2)
    expect(filterRollbarItems(items, { ...emptyRollbarFilter, search: '142', connectionId: 'c2' })).toHaveLength(1)
  })

  it('filters by level and environment', () => {
    expect(filterRollbarItems(items, { ...emptyRollbarFilter, level: 'warning' })).toHaveLength(1)
    expect(filterRollbarItems(items, { ...emptyRollbarFilter, environment: 'stage' }).map((i) => i.integrationId)).toEqual(['c2'])
  })

  it('facets are de-duped and sorted', () => {
    const f = rollbarFacets(items)
    expect(f.connections).toEqual([{ id: 'c1', label: 'Rollbar · api' }, { id: 'c2', label: 'Rollbar · api' }])
    expect(f.levels).toEqual(['error', 'warning'])
    expect(f.environments).toEqual(['prod', 'stage'])
  })
})
