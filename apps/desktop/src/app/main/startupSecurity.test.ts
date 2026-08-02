import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeBindings } from '@acorn/node-core/main/bindings.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { prepareSecurityState } from './startupSecurity'

const ENC_KEY = '0'.repeat(64)

describe('pre-listener security reconciliation', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => testDb.cleanup())

  it('protects legacy HTTP data and runs all documented retention paths', async () => {
    await testDb.db.insert(schema.prefs).values({ userId: 'alice', key: 'theme', value: 'dark' })
    await testDb.db.insert(schema.httpRequests).values({
      id: 'legacy',
      repoOwner: 'acme',
      repoName: 'web',
      name: 'Legacy',
      method: 'GET',
      url: 'https://example.test?token=plaintext-secret',
      createdAt: 1,
      updatedAt: 1,
    })
    await testDb.db.insert(schema.comments).values({
      userId: 'alice',
      repoId: 10,
      number: 1,
      id: 'orphan',
      body: 'private comment',
    })

    await prepareSecurityState({
      DB: testDb.db,
      SESSION_ENC_KEY: ENC_KEY,
    } as RuntimeBindings)

    const [request] = await testDb.db.select().from(schema.httpRequests)
    expect(request).toMatchObject({ userId: 'alice', encrypted: true })
    expect(request.url).not.toContain('plaintext-secret')
    expect(await testDb.db.select().from(schema.comments)).toEqual([])
  })
})
