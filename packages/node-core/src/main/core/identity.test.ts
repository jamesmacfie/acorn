import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../../server/db'
import { setRepoMirrorSource } from '../../server/repoMirror'
import { makeTestDb, type TestDb } from '../../server/routes/testDb'
import { createIdentityService } from './identity'

// This logic used to live inside plugins/http's legacy-row migration, where it was the plugin's excuse
// for reading core's `prefs` and github's `repos`. It moved here, so its coverage moves here too: the
// "exactly one identity, or nothing" rule is what stops an unowned row being handed to the wrong login.
//
// The second source is no longer a table in this database — github owns the mirror — so the tests drive it
// through the slot the composition root fills (server/repoMirror.ts). That makes the LAST case below
// possible to write at all, and it is the one that matters most: an unfilled slot must fail CLOSED, never
// hand a legacy row to the only identity core happens to be able to see.

const withMirrorIdentities = (logins: string[]) =>
  setRepoMirrorSource({ list: async () => [], defaultBranch: async () => null, identities: async () => logins })

describe('CoreServices.identity.sole', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => {
    setRepoMirrorSource(null) // a leaked source would silently decide the next test
    testDb.cleanup()
  })

  it('is null on an empty database with no mirror', async () => {
    expect(await createIdentityService(testDb.db).sole()).toBeNull()
  })

  it('finds the one identity whether its only evidence is a pref or a mirrored repo', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: 'alice', key: 'theme', value: 'dark' })
    expect(await createIdentityService(testDb.db).sole()).toBe('alice')

    const other = makeTestDb()
    try {
      withMirrorIdentities(['bob'])
      expect(await createIdentityService(other.db).sole()).toBe('bob')
    } finally {
      other.cleanup()
    }
  })

  it('is null once two identities exist, even across the two sources', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: 'alice', key: 'theme', value: 'dark' })
    withMirrorIdentities(['bob'])
    expect(await createIdentityService(testDb.db).sole()).toBeNull()
  })

  it('counts one identity once, no matter how many rows it owns', async () => {
    await testDb.db.insert(schema.prefs).values([
      { userId: 'alice', key: 'theme', value: 'dark' },
      { userId: 'alice', key: 'style', value: 'flat' },
    ])
    withMirrorIdentities(['alice'])
    expect(await createIdentityService(testDb.db).sole()).toBe('alice')
  })

  // The degradation direction, pinned. With github disabled or its init failed, a node whose ONLY identity
  // evidence is mirror rows must refuse to name one — `sole()` returning 'alice' here would let plugins/http
  // claim unscoped legacy rows for a login core cannot actually confirm is alone.
  it('fails closed when the mirror slot is unfilled and prefs disagree', async () => {
    await testDb.db.insert(schema.prefs).values([
      { userId: 'alice', key: 'theme', value: 'dark' },
      { userId: 'bob', key: 'theme', value: 'light' },
    ])
    expect(await createIdentityService(testDb.db).sole()).toBeNull()
  })
})
