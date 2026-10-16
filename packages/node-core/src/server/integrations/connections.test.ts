import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { connectionProviderRegistry } from './connectionProviders/registry'
import {
  connectProvider,
  disconnectConnection,
  externalRefForConnection,
  freshConnection,
  renameConnection,
  rotateConnection,
  setConnectionDisabled,
  testConnection,
} from './connections'
import { publicConnectionProvider } from './providerShared'
import { ProviderOperationError } from './types'
import { SecretService } from '../core/secrets'
import { connectionName, MAX_CONNECTION_NAME } from '@acorn/protocol/integrations.ts'

// The socket is the boundary worth stubbing: everything above it is the code under test, and a real hub
// has no connections in a unit test, so a broadcast would be a silent no-op and prove nothing.
const { broadcasts } = vi.hoisted(() => ({ broadcasts: [] as Record<string, unknown>[] }))
vi.mock('../transport/wsHub', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsBroadcast: (frame: Record<string, unknown>) => void broadcasts.push(frame),
}))

const ENCRYPTION_KEY = '11'.repeat(32)
const SECRETS = new SecretService(ENCRYPTION_KEY)
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
      return secret === 'rejected' ? { ok: false, error: 'provider_needs_auth' as const } : { ok: true }
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
    broadcasts.length = 0
  })

  afterEach(() => {
    testDb.cleanup()
  })

  it('keeps an owner-given name through a rotate, and clears it back to the provider label', async () => {
    const connected = await connectProvider(
      testDb.db,
      'alice',
      { providerId: PROVIDER_ID, credentials: { apiKey: 'first-key' } },
      SECRETS,
    )
    // Nothing named yet, so the provider's own label is what a surface shows.
    expect(connected.name).toBeUndefined()
    expect(connectionName(connected)).toBe('Connection only')

    await expect(renameConnection(testDb.db, 'alice', connected.id, '  Work  ')).resolves.toMatchObject({
      name: 'Work',
    })
    // The whole reason the name is its own column: a new credential rewrites `label` from the
    // provider, and a name kept there would go with it.
    await rotateConnection(testDb.db, 'alice', connected.id, { credentials: { apiKey: 'rotated-key' } }, SECRETS)
    const [afterRotate] = await testDb.db.select().from(schema.integrations)
    expect(afterRotate.name).toBe('Work')
    expect(connectionName(afterRotate)).toBe('Work')

    await expect(
      renameConnection(testDb.db, 'alice', connected.id, 'x'.repeat(MAX_CONNECTION_NAME + 1)),
    ).rejects.toMatchObject({ code: 'provider_bad_config' })

    // Blank and null both mean "go back to the provider's label" rather than storing an empty name.
    // The summary drops the key rather than sending `name: null`, so a client reads one absent field.
    const blanked = await renameConnection(testDb.db, 'alice', connected.id, '   ')
    expect('name' in blanked).toBe(false)
    const [cleared] = await testDb.db.select().from(schema.integrations)
    expect(cleared.name).toBeNull()
    expect(connectionName(cleared)).toBe('Connection only')
  })

  it('encrypts, summarizes, rotates, tests, and deletes a connection-only provider', async () => {
    const connected = await connectProvider(
      testDb.db,
      'alice',
      { providerId: PROVIDER_ID, credentials: { apiKey: 'first-key' } },
      SECRETS,
    )

    expect(connected).toMatchObject({
      providerId: PROVIDER_ID,
      status: 'connected',
      capabilities: { textGeneration: 'available' },
    })

    const [stored] = await testDb.db.select().from(schema.integrations)
    expect(stored.encryptedCredentials).not.toContain('first-key')
    expect(await SECRETS.reveal(stored.encryptedCredentials, 'test')).toBe('first-key')
    expect(stored.config).toBe('{"safe":true}')

    await expect(
      connectProvider(testDb.db, 'alice', { providerId: PROVIDER_ID, credentials: { apiKey: 'second-key' } }, SECRETS),
    ).rejects.toMatchObject({ code: 'provider_bad_config' })

    await rotateConnection(testDb.db, 'alice', connected.id, { credentials: { apiKey: 'rotated-key' } }, SECRETS)
    const [rotated] = await testDb.db.select().from(schema.integrations)
    expect(await SECRETS.reveal(rotated.encryptedCredentials, 'test')).toBe('rotated-key')

    await expect(testConnection(testDb.db, 'alice', connected.id, SECRETS)).resolves.toMatchObject({
      status: 'connected',
    })
    await expect(setConnectionDisabled(testDb.db, 'alice', connected.id, true)).resolves.toMatchObject({
      status: 'disabled',
    })
    await expect(setConnectionDisabled(testDb.db, 'alice', connected.id, false)).resolves.toMatchObject({
      status: 'connected',
    })
    expect(() => externalRefForConnection(rotated, 'ITEM-1')).toThrow(ProviderOperationError)
    // The code is the contract; the message is the reason, and a connection-only provider has no
    // entry in the integration registry to stamp a reference with.
    expect(() => externalRefForConnection(rotated, 'ITEM-1')).toThrow(
      expect.objectContaining({
        code: 'provider_bad_config',
        message: expect.stringContaining('No integration provider named'),
      }),
    )

    await disconnectConnection(testDb.db, 'alice', connected.id)
    expect(await testDb.db.select().from(schema.integrations)).toEqual([])
  })

  // Every status write announces itself (docs/plugins/events.md § Hearing a core event), so a second
  // client and every integration plugin hear about `needs-auth` before the next 401.
  it('broadcasts connection:changed on every status write', async () => {
    const connected = await connectProvider(
      testDb.db,
      'alice',
      { providerId: PROVIDER_ID, credentials: { apiKey: 'first-key' } },
      SECRETS,
    )
    await rotateConnection(testDb.db, 'alice', connected.id, { credentials: { apiKey: 'rotated-key' } }, SECRETS)
    await testConnection(testDb.db, 'alice', connected.id, SECRETS)
    await setConnectionDisabled(testDb.db, 'alice', connected.id, true)
    await setConnectionDisabled(testDb.db, 'alice', connected.id, false)

    expect(broadcasts).toEqual(
      ['connected', 'connected', 'connected', 'disabled', 'connected'].map((status) => ({
        channel: 'connection:changed',
        integrationId: connected.id,
        providerId: PROVIDER_ID,
        status,
      })),
    )
  })

  it('broadcasts the demotion nobody asked for', async () => {
    // `rejected` is what this provider's `test` treats as a revoked credential, so this is the shape of
    // the failure a client would otherwise discover by getting a 401 back.
    const connected = await connectProvider(
      testDb.db,
      'alice',
      { providerId: PROVIDER_ID, credentials: { apiKey: 'rejected' } },
      SECRETS,
    )
    broadcasts.length = 0

    await expect(testConnection(testDb.db, 'alice', connected.id, SECRETS)).resolves.toMatchObject({
      status: 'needs-auth',
    })

    expect(broadcasts).toEqual([
      { channel: 'connection:changed', integrationId: connected.id, providerId: PROVIDER_ID, status: 'needs-auth' },
    ])
  })

  it('announces deletion after cascading connection-owned mappings and task links', async () => {
    const connected = await connectProvider(
      testDb.db,
      'alice',
      { providerId: PROVIDER_ID, credentials: { apiKey: 'first-key' } },
      SECRETS,
    )
    const now = Date.now()
    await testDb.db
      .insert(schema.workspaces)
      .values({ id: 'workspace-one', name: 'One', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await testDb.db.insert(schema.projects).values({
      id: 'project-one',
      name: 'One',
      path: null,
      workspaceId: 'workspace-one',
      sort: 0,
      hidden: false,
      createdAt: now,
      updatedAt: now,
    })
    await testDb.db.insert(schema.tasks).values({
      id: 'task-one',
      title: 'One',
      origin: 'local',
      projectId: 'project-one',
      status: 'active',
      sort: 0,
      createdAt: now,
      updatedAt: now,
    })
    await testDb.db.insert(schema.workspaceExternalProjects).values({
      workspaceId: 'workspace-one',
      integrationId: connected.id,
      externalId: 'remote-one',
      projectId: '',
      createdAt: now,
    })
    await testDb.db.insert(schema.taskLinks).values({
      taskId: 'task-one',
      integrationId: connected.id,
      provider: PROVIDER_ID,
      identifier: 'ITEM-1',
      createdAt: now,
    })
    broadcasts.length = 0

    await disconnectConnection(testDb.db, 'alice', connected.id)

    expect(await testDb.db.select().from(schema.workspaceExternalProjects)).toEqual([])
    expect(await testDb.db.select().from(schema.taskLinks)).toEqual([])
    expect(broadcasts).toEqual([
      { channel: 'connection:changed', integrationId: connected.id, providerId: PROVIDER_ID, deleted: true },
      { channel: 'workspace-projects:changed', providerId: PROVIDER_ID, workspaceIds: ['workspace-one'] },
      { channel: 'tasks:changed', taskId: null },
    ])
  })

  it('serializes concurrent creates when a provider limits connection count', async () => {
    const attempts = await Promise.allSettled([
      connectProvider(testDb.db, 'alice', { providerId: PROVIDER_ID, credentials: { apiKey: 'first-key' } }, SECRETS),
      connectProvider(testDb.db, 'alice', { providerId: PROVIDER_ID, credentials: { apiKey: 'second-key' } }, SECRETS),
    ])

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    expect(await testDb.db.select().from(schema.integrations)).toHaveLength(1)
  })
})

describe('a provider whose access token expires', () => {
  const REFRESHING_ID = 'refreshing-test'
  const refreshed: string[] = []
  let refusing = false
  const refreshingProvider = publicConnectionProvider({
    id: REFRESHING_ID,
    label: 'Refreshing',
    glyph: 'R',
    kind: 'generic',
    connection: {
      authKind: 'oauth',
      fields: [],
      connectable: true,
      disconnectable: true,
      async validate(credentials) {
        return credentials
      },
      normalize(credentials) {
        return {
          secret: credentials.accessToken!,
          refresh: { refreshToken: credentials.refreshToken!, expiresAt: Number(credentials.expiresAt) },
          label: 'Refreshing',
          account: null,
          scopes: [],
          config: {},
          capabilities: {},
        }
      },
      async test() {
        return { ok: true }
      },
      async refresh(refreshToken) {
        refreshed.push(refreshToken)
        await new Promise((resolve) => setTimeout(resolve, 5))
        if (refusing) throw new ProviderOperationError('provider_needs_auth', 401)
        return {
          secret: `access-${refreshed.length}`,
          refreshToken: `refresh-${refreshed.length}`,
          expiresAt: Date.now() + 7_200_000,
        }
      },
    },
    capabilities: {},
    budgets: { maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 1 },
  })
  let testDb: TestDb

  beforeAll(() => {
    if (!connectionProviderRegistry.get(REFRESHING_ID)) connectionProviderRegistry.register(refreshingProvider)
  })
  beforeEach(() => {
    testDb = makeTestDb()
    broadcasts.length = 0
    refreshed.length = 0
    refusing = false
  })
  afterEach(() => testDb.cleanup())

  const connect = (expiresAt: number) =>
    connectProvider(
      testDb.db,
      'alice',
      {
        providerId: REFRESHING_ID,
        credentials: { accessToken: 'access-0', refreshToken: 'refresh-0', expiresAt: String(expiresAt) },
      },
      SECRETS,
    )
  const stored = (id: string) =>
    testDb.db.select().from(schema.integrations).where(eq(schema.integrations.id, id)).get()!
  const secretOf = (row: { encryptedCredentials: string }) => SECRETS.use(row.encryptedCredentials, 'test', (v) => v)

  it('stores the refresh token sealed, and leaves a token far from expiry alone', async () => {
    const connected = await connect(Date.now() + 7_200_000)
    const row = stored(connected.id)
    expect(row.encryptedRefreshToken).not.toContain('refresh-0')
    expect(await SECRETS.use(row.encryptedRefreshToken!, 'test', (v) => v)).toBe('refresh-0')
    expect(await freshConnection(testDb.db, row, SECRETS)).toBe(row)
    expect(refreshed).toEqual([])
  })

  it('renews a token near expiry once, however many callers ask, and writes both tokens back', async () => {
    const connected = await connect(Date.now() + 60_000)
    const row = stored(connected.id)
    const [first, second] = await Promise.all([
      freshConnection(testDb.db, row, SECRETS),
      freshConnection(testDb.db, row, SECRETS),
    ])
    expect(refreshed).toEqual(['refresh-0'])
    expect(await secretOf(first!)).toBe('access-1')
    expect(second).toBe(first)
    const after = stored(connected.id)
    expect(await secretOf(after)).toBe('access-1')
    expect(await SECRETS.use(after.encryptedRefreshToken!, 'test', (v) => v)).toBe('refresh-1')
    expect(after.credentialExpiresAt).toBeGreaterThan(Date.now() + 3_600_000)
  })

  it('renews on demand, which is how a caller answers a 401', async () => {
    const connected = await connect(Date.now() + 7_200_000)
    const fresh = await freshConnection(testDb.db, stored(connected.id), SECRETS, { force: true })
    expect(await secretOf(fresh!)).toBe('access-1')
  })

  it('marks the connection as needing sign-in when the refresh is refused, and stops refreshing', async () => {
    refusing = true
    const connected = await connect(Date.now() - 1)
    expect(await freshConnection(testDb.db, stored(connected.id), SECRETS)).toBeNull()
    expect(stored(connected.id)).toMatchObject({ status: 'needs-auth', lastError: 'provider_needs_auth' })
    expect(broadcasts.at(-1)).toMatchObject({ status: 'needs-auth' })
    await freshConnection(testDb.db, stored(connected.id), SECRETS, { force: true })
    expect(refreshed).toHaveLength(1)
  })
})
