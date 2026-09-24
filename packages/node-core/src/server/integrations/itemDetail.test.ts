import { afterEach, expect, it } from 'vitest'
import { makeTestDb } from '../../testkit/db'
import { defaultBudgets, publicProvider } from './providerShared'
import { integrationProviderRegistry } from './registry'
import { warmItemDetails } from './itemDetail'
import type { IntegrationProviderContribution, ProviderItemDetail } from './types'

const provider = (id: string, detail?: ProviderItemDetail): IntegrationProviderContribution =>
  publicProvider({
    id, label: id, glyph: 'brand:linear', kind: 'issue-tracker',
    connection: { authKind: 'api-key', connectable: true, disconnectable: true, fields: [], validate: async () => ({}), normalize: () => ({}), test: async () => ({ ok: true }) },
    capabilities: {}, externalIds: {}, resources: [], budgets: defaultBudgets, memory: {}, detail,
  } as never)

afterEach(() => integrationProviderRegistry.removeForPlugin('test'))

it('asks each linked provider that has a detail read, and swallows its failures', async () => {
  const db = makeTestDb()
  const asked: string[] = []
  integrationProviderRegistry.register(provider('tracker', async (_context, identifier) => {
    asked.push(identifier)
    throw new Error('offline')
  }), 'test')
  integrationProviderRegistry.register(provider('summaries'), 'test')

  warmItemDetails({ db: db.db, secrets: db.secrets }, 'owner', [
    { providerId: 'tracker', connectionId: 'c1', identifier: 'ENG-42' },
    { providerId: 'summaries', connectionId: 'c2', identifier: 'S-1' },
    { providerId: 'gone', connectionId: 'c3', identifier: 'G-1' },
  ])
  await new Promise((resolve) => setImmediate(resolve))

  expect(asked).toEqual(['ENG-42'])
  db.cleanup()
})
