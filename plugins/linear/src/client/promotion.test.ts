import { describe, expect, it } from 'vitest'
import { prepareLinearPromotion } from './promotion'
import type { LinearProjectIssue } from '../shared/api'

describe('linear source promotion', () => {
  it('uses Linear branch suggestions and connection-scoped links', () => {
    const item: LinearProjectIssue = {
      integrationId: 'linear-work', identifier: 'ENG-42', title: 'Ship it', url: 'https://linear.app/acme/issue/ENG-42',
      branchName: 'eng-42-ship-it', state: null, assignee: null,
      priority: null, priorityLabel: null, updatedAt: null, labels: [],
    }
    expect(prepareLinearPromotion(item, { owner: 'acme', repo: 'widget' })).toMatchObject({
      origin: 'linear', repoOwner: 'acme', repoName: 'widget', branch: 'eng-42-ship-it',
      links: [{ connectionId: 'linear-work', identifier: 'ENG-42' }],
    })
  })
})
