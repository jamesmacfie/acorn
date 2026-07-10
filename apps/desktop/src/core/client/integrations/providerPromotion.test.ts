import { describe, expect, it } from 'vitest'
import type { LinearProjectIssue, RollbarItem } from '../../shared/api'
import { prepareLinearPromotion, prepareRollbarPromotion } from './providerPromotion'

describe('provider-owned source promotion', () => {
  it('uses Linear branch suggestions and connection-scoped links', () => {
    const item: LinearProjectIssue = {
      integrationId: 'linear-work', identifier: 'ENG-42', title: 'Ship it', url: 'https://linear.app/acme/issue/ENG-42',
      branchName: 'eng-42-ship-it', state: null, assignee: null,
    }
    expect(prepareLinearPromotion(item, { owner: 'acme', repo: 'widget' })).toMatchObject({
      origin: 'linear', repoOwner: 'acme', repoName: 'widget', branch: 'eng-42-ship-it',
      links: [{ connectionId: 'linear-work', identifier: 'ENG-42' }],
    })
  })

  it('normalizes the chosen Rollbar branch and keeps the visible counter identity', () => {
    const item: RollbarItem = {
      integrationId: 'rollbar-api', identifier: '142', title: 'Token is null', level: 'error', environment: 'prod',
      status: 'active', totalOccurrences: 3, firstOccurrenceAt: 1, lastOccurrenceAt: 2,
    }
    expect(prepareRollbarPromotion(item, { owner: 'acme', repo: 'widget', branch: 'Fix Token 142' })).toMatchObject({
      origin: 'rollbar', repoOwner: 'acme', repoName: 'widget', branch: 'fix-token-142',
      links: [{ connectionId: 'rollbar-api', identifier: '142' }],
    })
  })
})
