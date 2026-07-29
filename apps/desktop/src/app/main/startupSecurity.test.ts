import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeBindings } from '../../core/main/bindings'
import { schema } from '../../core/server/db'
import { OauthAccountService } from '../../core/server/publicApi/oauthAccountService'
import { TokenService } from '../../core/server/publicApi/tokenService'
import { makeTestDb, type TestDb } from '../../core/server/routes/testDb'
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
    await testDb.db.insert(schema.commandExecutions).values({
      id: 'old-command',
      taskId: 'task',
      status: 'succeeded',
      stdout: 'private output',
      stderr: '',
      timeoutMs: 1000,
      createdAt: 1,
    })
    await testDb.db.insert(schema.apiIdempotency).values({
      tokenId: 'token',
      operationId: 'operation',
      key: 'key',
      requestHash: 'hash',
      responseStatus: 200,
      responseBody: '{"private":true}',
      createdAt: 1,
      expiresAt: 2,
    })
    const oauth = new OauthAccountService(testDb.db, ENC_KEY)
    await oauth.upsertGithub({ login: 'alice', accessToken: 'unused-token', name: 'Alice', avatar: '', scopes: [] })

    await prepareSecurityState({
      DB: testDb.db,
      SESSION_ENC_KEY: ENC_KEY,
      API_TOKENS: new TokenService(testDb.db),
      OAUTH_ACCOUNTS: oauth,
    } as RuntimeBindings)

    const [request] = await testDb.db.select().from(schema.httpRequests)
    expect(request).toMatchObject({ userId: 'alice', encrypted: true })
    expect(request.url).not.toContain('plaintext-secret')
    expect(await testDb.db.select().from(schema.comments)).toEqual([])
    expect(await testDb.db.select().from(schema.commandExecutions)).toEqual([])
    expect(await testDb.db.select().from(schema.apiIdempotency)).toEqual([])
    expect(await oauth.resolveGithubToken('alice')).toBeNull()
  })
})
