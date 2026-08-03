import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../../server/db'
import { makeTestDb, type TestDb } from '../../server/routes/testDb'
import { createIdentityService } from './identity'

// This logic used to live inside plugins/http's legacy-row migration, where it was the plugin's excuse
// for reading core's `prefs` and github's `repos`. It moved here, so its coverage moves here too: the
// "exactly one identity, or nothing" rule is what stops an unowned row being handed to the wrong login.

describe('CoreServices.identity.sole', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => testDb.cleanup())

  it('is null on an empty database', async () => {
    expect(await createIdentityService(testDb.db).sole()).toBeNull()
  })

  it('finds the one identity whether its only evidence is a pref or a repo', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: 'alice', key: 'theme', value: 'dark' })
    expect(await createIdentityService(testDb.db).sole()).toBe('alice')

    const other = makeTestDb()
    try {
      await other.db.insert(schema.repos).values({ userId: 'bob', id: 1, owner: 'acme', name: 'web', private: false, fetchedAt: 0 })
      expect(await createIdentityService(other.db).sole()).toBe('bob')
    } finally {
      other.cleanup()
    }
  })

  it('is null once two identities exist, even across the two tables', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: 'alice', key: 'theme', value: 'dark' })
    await testDb.db.insert(schema.repos).values({ userId: 'bob', id: 1, owner: 'acme', name: 'web', private: false, fetchedAt: 0 })
    expect(await createIdentityService(testDb.db).sole()).toBeNull()
  })

  it('counts one identity once, no matter how many rows it owns', async () => {
    await testDb.db.insert(schema.prefs).values([
      { userId: 'alice', key: 'theme', value: 'dark' },
      { userId: 'alice', key: 'style', value: 'flat' },
    ])
    await testDb.db.insert(schema.repos).values({ userId: 'alice', id: 1, owner: 'acme', name: 'web', private: false, fetchedAt: 0 })
    expect(await createIdentityService(testDb.db).sole()).toBe('alice')
  })
})
