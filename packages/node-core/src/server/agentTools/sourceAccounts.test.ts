import { afterEach, expect, it } from 'vitest'
import { schema } from '../db'
import { makeTestDb } from '../../testkit/db'
import { registerDataSource } from '../dataSources/registry'
import { withSourceAccounts } from './sourceAccounts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

it("names each source's provider and lists the person's accounts for those providers, without credentials", async () => {
  const testDb = makeTestDb()
  cleanups.push(testDb.cleanup)
  const source = { name: 'Pulls', singular: 'Pull', plural: 'Pulls', identityScope: 'Pull ID' }
  cleanups.push(
    registerDataSource('tracker', {
      ...source,
      sourceId: 'pulls',
      handler: '/v1/p/tracker/pulls',
      providerId: 'tracker',
    }).dispose,
  )
  for (const [id, userId, provider] of [
    ['mine', 'owner', 'tracker'],
    ['elsewhere', 'owner', 'another'],
    ['theirs', 'someone', 'tracker'],
  ] as const) {
    await testDb.db.insert(schema.integrations).values({
      id,
      userId,
      provider,
      label: 'Tracker',
      name: id === 'mine' ? 'Work' : null,
      encryptedCredentials: await testDb.secrets.seal(`${id}-token`),
      authKind: 'api-key',
      status: 'connected',
      createdAt: 1,
      updatedAt: 1,
    })
  }
  const result = await withSourceAccounts(testDb.db, 'owner', {
    sources: [{ pluginId: 'tracker', sourceId: 'pulls', ...source }] as never,
    discoveries: [],
  })
  expect(result.sources[0]).toMatchObject({ sourceId: 'pulls', providerId: 'tracker' })
  expect(result.accounts).toEqual([{ id: 'mine', providerId: 'tracker', label: 'Work', status: 'connected' }])
  expect(JSON.stringify(result)).not.toContain('token')
})
