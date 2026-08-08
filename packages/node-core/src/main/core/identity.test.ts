import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../../server/db'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { memoryIdentityStore } from '../activeIdentity'
import { createIdentityService, ensureBoundIdentity } from './identity/identity'

describe('ensureBoundIdentity', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => {
    testDb.cleanup()
  })

  it('mints an opaque owner id when nothing is bound', () => {
    const store = memoryIdentityStore()
    const owner = ensureBoundIdentity(testDb.db, store)
    expect(owner).toMatch(/^owner-[0-9a-f-]{36}$/)
    expect(store.get()).toBe(owner)
    expect(createIdentityService(store).active()).toBe(owner)
  })

  it('keeps an already-bound identity — a legacy GitHub login stays the owner id', () => {
    const store = memoryIdentityStore('alice')
    expect(ensureBoundIdentity(testDb.db, store)).toBe('alice')
    expect(store.get()).toBe('alice')
  })

  it('adopts pre-identity rows scoped under the empty string', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: '', key: 'theme', value: 'dark' })
    await testDb.db.insert(schema.syncState).values({ userId: '', resource: 'repos', etag: null, fetchedAt: 1 })
    const owner = ensureBoundIdentity(testDb.db, memoryIdentityStore())
    const prefs = await testDb.db.select().from(schema.prefs)
    const sync = await testDb.db.select().from(schema.syncState)
    expect(prefs).toEqual([{ userId: owner, key: 'theme', value: 'dark' }])
    expect(sync.map((r) => r.userId)).toEqual([owner])
  })

  it('drops the unscoped remnant when the owner already has the row', async () => {
    await testDb.db.insert(schema.prefs).values([
      { userId: 'alice', key: 'theme', value: 'dark' },
      { userId: '', key: 'theme', value: 'light' },
    ])
    ensureBoundIdentity(testDb.db, memoryIdentityStore('alice'))
    const prefs = await testDb.db.select().from(schema.prefs)
    // The owner's copy wins; the '' remnant is deleted, not merged.
    expect(prefs).toEqual([{ userId: 'alice', key: 'theme', value: 'dark' }])
  })

  it('is idempotent across boots', async () => {
    const store = memoryIdentityStore()
    const first = ensureBoundIdentity(testDb.db, store)
    await testDb.db.insert(schema.prefs).values({ userId: first, key: 'theme', value: 'dark' })
    expect(ensureBoundIdentity(testDb.db, store)).toBe(first)
    expect(await testDb.db.select().from(schema.prefs)).toHaveLength(1)
  })
})
