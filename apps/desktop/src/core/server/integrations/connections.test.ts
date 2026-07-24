import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../db'
import { makeTestDb, type TestDb } from '../routes/testDb'
import { decryptSecret } from '../session'
import { connectionProviderRegistry } from './connectionRegistry'
import {
  connectProvider,
  disconnectConnection,
  externalRefForConnection,
  rotateConnection,
  setConnectionDisabled,
  testConnection,
} from './connections'
import { publicConnectionProvider } from './providers/shared'
import { ProviderOperationError } from './types'

const ENCRYPTION_KEY = '11'.repeat(32)
const PROVIDER_ID = 'connection-only-test'

const connectionOnlyProvider = publicConnectionProvider({
  id: PROVIDER_ID,
  label: 'Connection only',
  glyph: 'C',
  kind: 'generic',
  connection: {
    authKind: 'api-key',
    fields: [{ id: 'apiKey', label: 'API key', type: 'password', required: true }],
    connectable: true,
    disconnectable: true,
    maxConnections: 1,
    async validate(credentials) {
      const secret = credentials.apiKey?.trim()
      if (!secret) throw new ProviderOperationError('provider_bad_config', 400)
      return secret
    },
    normalize(_credentials, secret) {
      return {
        secret,
        label: 'Connection only',
        account: null,
        scopes: [],
        config: { safe: true },
        capabilities: { textGeneration: 'available' as const },
      }
    },
    async test(secret) {
      return secret === 'rejected'
        ? { ok: false, error: 'provider_needs_auth' as const }
        : { ok: true }
    },
  },
  capabilities: { textGeneration: true },
  budgets: { maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 1 },
})

describe('connection-only provider lifecycle', () => {
  let testDb: TestDb

  beforeAll(() => {
    if (!connectionProviderRegistry.get(PROVIDER_ID)) {
      connectionProviderRegistry.register(connectionOnlyProvider)
    }
  })

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => {
    testDb.cleanup()
  })

  it('encrypts, summarizes, rotates, tests, and deletes a connection-only provider', async () => {
    const connected = await connectProvider(
      testDb.db,
      'alice',
      { providerId: PROVIDER_ID, credentials: { apiKey: 'first-key' } },
      ENCRYPTION_KEY,
    )

    expect(connected).toMatchObject({
      providerId: PROVIDER_ID,
      status: 'connected',
      capabilities: { textGeneration: 'available' },
    })

    const [stored] = await testDb.db.select().from(schema.integrations)
    expect(stored.authRef).not.toContain('first-key')
    expect(await decryptSecret(stored.authRef, ENCRYPTION_KEY)).toBe('first-key')
    expect(stored.config).toBe('{"safe":true}')

    await expect(connectProvider(
      testDb.db,
      'alice',
      { providerId: PROVIDER_ID, credentials: { apiKey: 'second-key' } },
      ENCRYPTION_KEY,
    )).rejects.toMatchObject({ code: 'provider_bad_config' })

    await rotateConnection(
      testDb.db,
      'alice',
      connected.id,
      { credentials: { apiKey: 'rotated-key' } },
      ENCRYPTION_KEY,
    )
    const [rotated] = await testDb.db.select().from(schema.integrations)
    expect(await decryptSecret(rotated.authRef, ENCRYPTION_KEY)).toBe('rotated-key')

    await expect(testConnection(testDb.db, 'alice', connected.id, ENCRYPTION_KEY)).resolves.toMatchObject({
      status: 'connected',
    })
    await expect(setConnectionDisabled(testDb.db, 'alice', connected.id, true)).resolves.toMatchObject({
      status: 'disabled',
    })
    await expect(setConnectionDisabled(testDb.db, 'alice', connected.id, false)).resolves.toMatchObject({
      status: 'connected',
    })
    expect(() => externalRefForConnection(rotated, 'ITEM-1')).toThrow(ProviderOperationError)
    expect(() => externalRefForConnection(rotated, 'ITEM-1')).toThrow('provider_bad_config')

    await disconnectConnection(testDb.db, 'alice', connected.id)
    expect(await testDb.db.select().from(schema.integrations)).toEqual([])
  })

  it('serializes concurrent creates when a provider limits connection count', async () => {
    const attempts = await Promise.allSettled([
      connectProvider(
        testDb.db,
        'alice',
        { providerId: PROVIDER_ID, credentials: { apiKey: 'first-key' } },
        ENCRYPTION_KEY,
      ),
      connectProvider(
        testDb.db,
        'alice',
        { providerId: PROVIDER_ID, credentials: { apiKey: 'second-key' } },
        ENCRYPTION_KEY,
      ),
    ])

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    expect(await testDb.db.select().from(schema.integrations)).toHaveLength(1)
  })
})
