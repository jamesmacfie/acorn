import { describe, expect, it } from 'vitest'
import type { RollbarItemSummary } from '../shared/api'
import { rollbarSearchItems, rollbarSearchScore } from './paletteSearch'

const item = (over: Partial<RollbarItemSummary> = {}): RollbarItemSummary => ({
  integrationId: 'rollbar-a',
  integrationLabel: 'Rollbar · acme',
  identifier: '142',
  itemId: '999',
  url: null,
  title: 'TypeError: cannot read length',
  level: 'error',
  environment: 'production',
  status: 'active',
  totalOccurrences: 4,
  firstOccurrenceAt: 1,
  lastOccurrenceAt: 2,
  ...over,
})

describe('what a typed word matches', () => {
  it('ranks an exact counter above a title, and a title above the facts around it', () => {
    const counter = item({ identifier: '42', title: 'Something else' })
    const titled = item({ identifier: '7', title: '42 is not a title match at the start' })
    // Only `level` carries the word, which is the weakest kind of match a row can have.
    const level = item({ identifier: '8', title: 'Unrelated', level: 'error' })

    expect(rollbarSearchScore(counter, '42')).toBeGreaterThan(rollbarSearchScore(titled, '42')!)
    expect(rollbarSearchScore(titled, '42')).toBeGreaterThan(rollbarSearchScore(level, 'error')!)
  })

  it('reads a pasted #142 as the counter Rollbar shows everywhere', () => {
    expect(rollbarSearchScore(item({ identifier: '142' }), '#142')).toBe(4)
  })

  it('matches the framework, which is how one account tells its services apart', () => {
    expect(rollbarSearchScore(item({ framework: 'rails' }), 'rails')).not.toBeNull()
    expect(rollbarSearchScore(item(), 'rails')).toBeNull()
  })

  it('answers every row for an empty query, so the frame opens on the recent list', () => {
    expect(rollbarSearchScore(item(), '  ')).toBe(0)
  })
})

describe('the rows a search answers with', () => {
  it('addresses a row by connection and counter, because a counter is only unique in its connection', () => {
    const [row] = rollbarSearchItems([item({ integrationId: 'conn-1', identifier: '142' })], '142')
    expect(row.id).toBe('conn-1:142')
    expect(row.ref).toBe('142')
  })

  it('carries display facts and no credential, account or verb', () => {
    const [row] = rollbarSearchItems([item()], 'typeerror')
    expect(row).toEqual({
      id: 'rollbar-a:142',
      title: 'TypeError: cannot read length',
      subtitle: '#142 · error · production · Rollbar · acme',
      badge: '4 occurrences',
      ref: '142',
    })
  })

  it('keeps a long title inside the bound the host would drop it for', () => {
    const [row] = rollbarSearchItems([item({ title: 'x'.repeat(1_000) })], 'xxx')
    expect(row.title).toHaveLength(300)
  })

  it('caps at what the host will render and keeps the incoming order within a tier', () => {
    const many = Array.from({ length: 80 }, (_, at) => item({ identifier: String(at), title: `boom ${at}` }))
    const rows = rollbarSearchItems(many, 'boom')
    expect(rows).toHaveLength(50)
    expect(rows[0].title).toBe('boom 0')
    expect(rows[49].title).toBe('boom 49')
  })

  it('drops a row nothing in the query matched', () => {
    expect(rollbarSearchItems([item({ title: 'Timeout' })], 'nothing here')).toEqual([])
  })
})
