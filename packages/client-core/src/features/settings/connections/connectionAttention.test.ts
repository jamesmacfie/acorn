import { describe, expect, it, vi } from 'vitest'

// A refused credential is a row that lands on the page listing its connection: Services for a service,
// AI models for a model key. Nothing else raises one.
vi.mock('../../../infra/node/apiClient', () => ({
  readJson: async () => ({
    providers: [
      { id: 'linear', label: 'Linear', kind: 'issue-tracker', connection: { kind: 'fields' } },
      { id: 'anthropic', label: 'Anthropic', kind: 'model-provider', connection: { kind: 'fields' } },
    ],
    integrations: [
      { id: 'c-1', providerId: 'linear', label: 'Linear · Acme', status: 'needs-auth', updatedAt: 5, lastValidatedAt: 4 },
      { id: 'c-2', providerId: 'anthropic', label: 'Anthropic', name: 'Work key', status: 'needs-auth', updatedAt: 7 },
      { id: 'c-3', providerId: 'linear', label: 'Linear · Other', status: 'disabled', updatedAt: 1 },
    ],
  }),
}))

import { connectionAttention } from './connectionAttention'

describe('connectionAttention', () => {
  it('raises a row per refused connection, pointing at the page that lists it', async () => {
    const rows = await connectionAttention.fetch('node-a', new AbortController().signal)
    expect(rows.map((row) => [row.title, row.target.resourceId, row.at])).toEqual([
      ['Linear · Acme needs you to sign in again', 'integrations', 4],
      ['Work key needs you to sign in again', 'ai-models', 7],
    ])
  })
})
