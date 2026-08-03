import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IdentityService } from '@acorn/node-core/main/core/index.ts'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/node-core/server/routes/testDb.ts'
import { httpRequests, httpVariables } from '../node/schema'
import { migrationsDir } from '../node/migrations'
import { openHttpValue, protectLegacyHttpStorage } from './storage'
import { SecretService } from '@acorn/node-core/main/core/secrets.ts'

const ENC_KEY = '0'.repeat(64)
const SECRETS = new SecretService(ENC_KEY)

// The identity question is core's now (CoreServices.identity), so these tests state the ANSWER rather
// than seeding the two tables it used to be derived from. That is the point of the seam: the migration's
// contract is "claim only when there is exactly one identity", and it no longer has an opinion about
// which tables prove that.
const identity = (sole: string | null): IdentityService => ({ sole: async () => sole })

describe('legacy HTTP storage protection', () => {
  let testDb: TestPluginDb

  beforeEach(() => {
    testDb = makeTestPluginDb('http', migrationsDir())
  })

  afterEach(() => testDb.cleanup())

  it('claims a legacy row for the sole known identity and encrypts every payload field', async () => {
    await testDb.db.insert(httpRequests).values({
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

    await protectLegacyHttpStorage(testDb.db, SECRETS, identity('alice'))

    const [row] = await testDb.db.select().from(httpRequests)
    expect(row).toMatchObject({ userId: 'alice', encrypted: true })
    expect(JSON.stringify(row)).not.toContain('Bearer secret')
    expect(await openHttpValue(row.url, row.encrypted, SECRETS)).toBe('https://example.test?token=secret')
  })

  it('leaves ownership quarantined when more than one identity exists', async () => {
    await testDb.db.insert(httpVariables).values({
      id: 'legacy-var',
      repoOwner: 'acme',
      repoName: 'web',
      name: 'TOKEN',
      kind: 'value',
      value: 'secret',
      createdAt: 1,
      updatedAt: 1,
    })

    // sole() === null is what "none, or more than one" looks like to this function.
    await protectLegacyHttpStorage(testDb.db, SECRETS, identity(null))

    const [row] = await testDb.db.select().from(httpVariables)
    expect(row).toMatchObject({ userId: '__legacy_unscoped__', encrypted: true })
    expect(row.value).not.toContain('secret')
  })
})
