import { describe, expect, it } from 'vitest'
import { prepareRollbarPromotion } from './promotion'
import type { RollbarItemSummary } from '../shared/api'

describe('rollbar source promotion', () => {
  it('normalizes the chosen Rollbar branch and keeps the visible counter identity', () => {
    const item: RollbarItemSummary = {
      integrationId: 'rollbar-api', integrationLabel: 'Rollbar · api', identifier: '142', itemId: '999',
      url: 'https://rollbar.com/item/999/',
      title: 'Token is null', level: 'error', environment: 'prod',
      status: 'active', totalOccurrences: 3, firstOccurrenceAt: 1, lastOccurrenceAt: 2,
    }
    expect(prepareRollbarPromotion(item, { owner: 'acme', repo: 'widget', branch: 'Fix Token 142' })).toMatchObject({
      origin: 'rollbar', repoOwner: 'acme', repoName: 'widget', branch: 'fix-token-142',
      links: [{ connectionId: 'rollbar-api', identifier: '142', ref: { displayId: '142', externalId: '999' } }],
    })
  })
})
