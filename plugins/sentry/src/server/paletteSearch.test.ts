import { describe, expect, it } from 'vitest'
import type { SentryIssueSummary } from '../shared/api'
import { sentrySearchItems, sentrySearchScore } from './paletteSearch'

const issue = (over: Partial<SentryIssueSummary> = {}): SentryIssueSummary => ({
  connectionId: 'c1',
  connectionLabel: 'Sentry · acme/web',
  id: '42',
  shortId: 'WEB-1',
  title: 'TypeError: cannot read length',
  culprit: 'app/checkout',
  level: 'error',
  status: 'unresolved',
  count: 4,
  userCount: 1,
  firstSeen: 1,
  lastSeen: 2,
  url: 'https://acme.sentry.io/issues/42/',
  ...over,
})

describe('what a typed word matches', () => {
  it('ranks an exact short id above a title, and a title above the facts around it', () => {
    const exact = issue({ shortId: 'WEB-7', title: 'Something else' })
    const titled = issue({ shortId: 'WEB-8', title: 'Retry web-7 failed' })
    const culprit = issue({ shortId: 'WEB-9', title: 'Unrelated', culprit: 'jobs/web-7' })
    expect(sentrySearchScore(exact, 'web-7')).toBeGreaterThan(sentrySearchScore(titled, 'web-7')!)
    expect(sentrySearchScore(titled, 'web-7')).toBeGreaterThan(sentrySearchScore(culprit, 'web-7')!)
  })

  it('finds an issue by a word in its title', () => {
    expect(sentrySearchScore(issue(), 'cannot read')).toBe(2)
    expect(sentrySearchScore(issue(), 'timeout')).toBeNull()
  })

  it('answers every issue for an empty query, so the palette opens on the newest', () => {
    expect(sentrySearchScore(issue(), '  ')).toBe(0)
  })
})

describe('the rows a search answers with', () => {
  it('addresses a row as the rail does and carries display facts only', () => {
    expect(sentrySearchItems([issue()], 'typeerror')).toEqual([
      {
        id: 'c1:42',
        title: 'TypeError: cannot read length',
        subtitle: 'WEB-1 · error · app/checkout · Sentry · acme/web',
        badge: '4 events',
        ref: 'WEB-1',
      },
    ])
  })

  it('keeps the incoming order within a tier and caps the rows', () => {
    const many = Array.from({ length: 80 }, (_, at) => issue({ id: String(at), title: `boom ${at}` }))
    const rows = sentrySearchItems(many, 'boom')
    expect(rows).toHaveLength(50)
    expect(rows[0]!.title).toBe('boom 0')
  })
})
