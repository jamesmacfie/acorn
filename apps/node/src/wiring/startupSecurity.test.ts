import { testSecretEnv } from '@acorn/node-core/server/routes/testDb.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeBindings } from '@acorn/node-core/main/bindings.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { prepareSecurityState } from './startupSecurity'

const ENC_KEY = '0'.repeat(64)

// One retention path left. The HTTP plaintext migration this file also used to cover moved into
// plugins/http's init when that plugin took ownership of `http_requests`/`http_variables`; its coverage
// moved with it (plugins/http/src/server/storage.test.ts).
describe('pre-listener security reconciliation', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => testDb.cleanup())

  it('prunes a mirror row whose repo is gone', async () => {
    await testDb.db.insert(schema.comments).values({
      userId: 'alice',
      repoId: 10,
      number: 1,
      id: 'orphan',
      body: 'private comment',
    })

    await prepareSecurityState({
      DB: testDb.db,
      ...testSecretEnv(ENC_KEY),
    } as RuntimeBindings)

    expect(await testDb.db.select().from(schema.comments)).toEqual([])
  })
})
