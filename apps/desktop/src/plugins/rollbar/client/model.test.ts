import { describe, expect, it } from 'vitest'
import type { RollbarItemSummary, RollbarOccurrenceDetail, RollbarOccurrenceSummary } from '../../../core/shared/api'
import { agentContext, emptyRollbarFilter, filterRollbarItems, frameRepoPath, isRegressed, rollbarFacets, rollbarImpact, sortRollbarItems } from './model'

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

  it('sorts by occurrences and by level with recency tiebreak', () => {
    const mixed = [
      item({ identifier: 'a', level: 'warning', totalOccurrences: 5, lastOccurrenceAt: 100 }),
      item({ identifier: 'b', level: 'critical', totalOccurrences: 1, lastOccurrenceAt: 200 }),
      item({ identifier: 'c', level: 'critical', totalOccurrences: 3, lastOccurrenceAt: 300 }),
    ]
    expect(sortRollbarItems(mixed, 'occurrences').map((i) => i.identifier)).toEqual(['a', 'c', 'b'])
    expect(sortRollbarItems(mixed, 'level').map((i) => i.identifier)).toEqual(['c', 'b', 'a'])
  })

  it('regression = reactivated after first seen; absent/older fields are not regressions', () => {
    expect(isRegressed(item({ firstOccurrenceAt: 100, lastActivatedAt: 200 }))).toBe(true)
    expect(isRegressed(item({ firstOccurrenceAt: 100, lastActivatedAt: 100 }))).toBe(false)
    expect(isRegressed(item({ firstOccurrenceAt: 100 }))).toBe(false)
    expect(isRegressed(item({ lastActivatedAt: 200, firstOccurrenceAt: null }))).toBe(false)
  })
})

const occ = (over: Partial<RollbarOccurrenceSummary>): RollbarOccurrenceSummary => ({
  id: '1', occurredAt: null, uuid: null, url: null, kind: 'trace', exceptionClass: 'E', message: 'm',
  environment: null, codeVersion: null, request: null, personUsername: null,
  ...over,
})

describe('rollbarImpact', () => {
  it('rolls up users, spreads, and the last-24h share of the sample', () => {
    const now = 1_000_000_000_000
    const impact = rollbarImpact([
      occ({ id: '1', personUsername: 'jo', environment: 'prod', codeVersion: 'v1', occurredAt: now - 1000 }),
      occ({ id: '2', personUsername: 'jo', environment: 'prod', codeVersion: 'v2', occurredAt: now - 90_000_000 }),
      occ({ id: '3', personUsername: 'amy', environment: 'stage', occurredAt: now - 2000 }),
      occ({ id: '4' }),
    ], now)
    expect(impact).toEqual({
      sample: 4,
      users: 2,
      environments: [{ name: 'prod', count: 2 }, { name: 'stage', count: 1 }],
      versions: [{ name: 'v1', count: 1 }, { name: 'v2', count: 1 }],
      last24h: 2,
    })
  })
})

describe('frameRepoPath', () => {
  it('strips build prefixes and refuses unanchorable absolute paths', () => {
    expect(frameRepoPath('webpack:///./src/app.ts?abc')).toBe('src/app.ts')
    expect(frameRepoPath('./lib/x.rb')).toBe('lib/x.rb')
    expect(frameRepoPath('app/models/user.rb')).toBe('app/models/user.rb')
    expect(frameRepoPath('/app/services/billing/invoice.ts')).toBe('services/billing/invoice.ts')
    expect(frameRepoPath('/usr/lib/node_modules/x.js')).toBeNull()
    expect(frameRepoPath('<anonymous>')).toBeNull()
  })
})

describe('agentContext', () => {
  const detail: RollbarOccurrenceDetail = {
    id: '9', occurredAt: null, uuid: null, url: 'https://rollbar.com/occurrence/uuid/?uuid=x', kind: 'trace',
    exceptionClass: 'TypeError', message: 'plan is undefined',
    frames: [
      { filename: 'app/billing.ts', line: 214, column: null, method: 'chargeCustomer', code: [], inProject: true },
      { filename: 'node_modules/x.js', line: 1, column: null, method: null, code: [], inProject: false },
    ],
    request: { method: 'POST', url: '/api/charge' }, context: 'billing#charge', environment: 'prod',
    codeVersion: 'a3f9c21', platform: null, language: null, framework: null, server: null, person: null, notifier: null,
    truncated: false,
  }

  it('formats exception, in-project frames only, and the facts block', () => {
    const text = agentContext(item({ identifier: '142', title: 'boom', totalOccurrences: 7 }), detail)
    expect(text).toContain('Rollbar #142 [error] boom')
    expect(text).toContain('TypeError: plan is undefined')
    expect(text).toContain('at app/billing.ts:214 (chargeCustomer)')
    expect(text).not.toContain('node_modules/x.js')
    expect(text).toContain('environment: prod')
    expect(text).toContain('version: a3f9c21')
    expect(text).toContain('request: POST /api/charge')
    expect(text).toContain('occurrences: 7')
  })

  it('works without an item summary', () => {
    const text = agentContext(undefined, detail)
    expect(text.startsWith('TypeError')).toBe(true)
    expect(text).toContain('link: https://rollbar.com/occurrence/uuid/?uuid=x')
  })
})
