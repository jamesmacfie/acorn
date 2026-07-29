import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../../../core/server/db'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { openHttpValue, protectLegacyHttpStorage } from './storage'

const ENC_KEY = '0'.repeat(64)

describe('legacy HTTP storage protection', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => testDb.cleanup())

  it('claims a legacy row for the sole known identity and encrypts every payload field', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: 'alice', key: 'theme', value: 'dark' })
    await testDb.db.insert(schema.httpRequests).values({
      id: 'legacy',
      repoOwner: 'acme',
      repoName: 'web',
      name: 'Legacy',
      method: 'GET',
      url: 'https://example.test?token=secret',
      headers: '[{"name":"Authorization","value":"Bearer secret","enabled":true}]',
      bodyMode: 'none',
      body: '',
      auth: '{"mode":"none"}',
      vars: '{}',
      createdAt: 1,
      updatedAt: 1,
    })

    await protectLegacyHttpStorage(testDb.db, ENC_KEY)

    const [row] = await testDb.db.select().from(schema.httpRequests)
    expect(row).toMatchObject({ userId: 'alice', encrypted: true })
    expect(JSON.stringify(row)).not.toContain('Bearer secret')
    expect(await openHttpValue(row.url, row.encrypted, ENC_KEY)).toBe('https://example.test?token=secret')
  })

  it('leaves ownership quarantined when more than one identity exists', async () => {
    await testDb.db.insert(schema.prefs).values([
      { userId: 'alice', key: 'theme', value: 'dark' },
      { userId: 'bob', key: 'theme', value: 'light' },
    ])
    await testDb.db.insert(schema.httpVariables).values({
      id: 'legacy-var',
      repoOwner: 'acme',
      repoName: 'web',
      name: 'TOKEN',
      kind: 'value',
      value: 'secret',
      createdAt: 1,
      updatedAt: 1,
    })

    await protectLegacyHttpStorage(testDb.db, ENC_KEY)

    const [row] = await testDb.db.select().from(schema.httpVariables)
    expect(row).toMatchObject({ userId: '__legacy_unscoped__', encrypted: true })
    expect(row.value).not.toContain('secret')
  })
})
