import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { openHttpValue, protectLegacyHttpStorage } from './storage'
import { SecretService } from '@acorn/node-core/main/core/secrets.ts'

const ENC_KEY = '0'.repeat(64)
const SECRETS = new SecretService(ENC_KEY)

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

    await protectLegacyHttpStorage(testDb.db, SECRETS)

    const [row] = await testDb.db.select().from(schema.httpRequests)
    expect(row).toMatchObject({ userId: 'alice', encrypted: true })
    expect(JSON.stringify(row)).not.toContain('Bearer secret')
    expect(await openHttpValue(row.url, row.encrypted, SECRETS)).toBe('https://example.test?token=secret')
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

    await protectLegacyHttpStorage(testDb.db, SECRETS)

    const [row] = await testDb.db.select().from(schema.httpVariables)
    expect(row).toMatchObject({ userId: '__legacy_unscoped__', encrypted: true })
    expect(row.value).not.toContain('secret')
  })
})
