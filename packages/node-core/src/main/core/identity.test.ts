import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../../server/db'
import { setRepoMirrorSource } from '../../server/repoMirror'
import { makeTestDb, type TestDb } from '../../server/routes/testDb'
import { memoryIdentityStore } from '../activeIdentity'
import { createIdentityService } from './identity'

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
    expect(await createIdentityService(testDb.db, memoryIdentityStore()).sole()).toBeNull()
  })

  it('finds the one identity whether its only evidence is a pref or a mirrored repo', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: 'alice', key: 'theme', value: 'dark' })
    expect(await createIdentityService(testDb.db, memoryIdentityStore()).sole()).toBe('alice')

    const other = makeTestDb()
    try {
      withMirrorIdentities(['bob'])
      expect(await createIdentityService(other.db, memoryIdentityStore()).sole()).toBe('bob')
    } finally {
      other.cleanup()
    }
  })

  it('is null once two identities exist, even across the two sources', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: 'alice', key: 'theme', value: 'dark' })
    withMirrorIdentities(['bob'])
    expect(await createIdentityService(testDb.db, memoryIdentityStore()).sole()).toBeNull()
  })

  it('counts one identity once, no matter how many rows it owns', async () => {
    await testDb.db.insert(schema.prefs).values([
      { userId: 'alice', key: 'theme', value: 'dark' },
      { userId: 'alice', key: 'style', value: 'flat' },
    ])
    withMirrorIdentities(['alice'])
    expect(await createIdentityService(testDb.db, memoryIdentityStore()).sole()).toBe('alice')
  })

  // The degradation direction, pinned. With github disabled or its init failed, a node whose ONLY identity
  // evidence is mirror rows must refuse to name one — `sole()` returning 'alice' here would let plugins/http
  // claim unscoped legacy rows for a login core cannot actually confirm is alone.
  it('fails closed when the mirror slot is unfilled and prefs disagree', async () => {
    await testDb.db.insert(schema.prefs).values([
      { userId: 'alice', key: 'theme', value: 'dark' },
      { userId: 'bob', key: 'theme', value: 'light' },
    ])
    expect(await createIdentityService(testDb.db, memoryIdentityStore()).sole()).toBeNull()
  })
})
