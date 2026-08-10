import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { SecretService } from '../../main/core/secrets'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { connectionProviderRegistry } from './connectionRegistry'
import { boundProviderProjects, listConnectionProjects, PROVIDER_PROJECT_LIMITS } from './projectSource'
import { defaultBudgets, publicConnectionProvider } from './providers/shared'
import { ProviderOperationError, type ProviderProject, type ProviderProjectSource } from './types'

const OWNER = 'project-source-owner'
const USER = 'owner-1'
const SECRETS = new SecretService('31'.repeat(32))

const provider = (id: string, projects?: ProviderProjectSource) => publicConnectionProvider({
  id,
  label: 'Tracker',
  glyph: 'T',
  kind: 'issue-tracker',
  connection: {
    authKind: 'api-key' as const,
    fields: [],
    connectable: true,
    disconnectable: true,
    async validate() { return 'secret' },
    normalize(_credentials, secret) {
      return { secret, label: 'Tracker', account: null, scopes: [], config: {}, capabilities: {} }
    },
    async test() { return { ok: true as const } },
  },
  capabilities: { browse: true },
  ...(projects ? { projects } : {}),
  budgets: defaultBudgets,
})

const register = (id: string, projects?: ProviderProjectSource): void =>
  connectionProviderRegistry.register(provider(id, projects), OWNER)

const seedConnection = async (
  testDb: TestDb,
  options: { id: string; provider: string; status?: string; authRef?: string; config?: string },
): Promise<void> => {
  const now = Date.now()
  await testDb.db.insert(schema.integrations).values({
    id: options.id,
    userId: USER,
    provider: options.provider,
    label: 'Tracker one',
    authRef: options.authRef ?? (await SECRETS.seal('live-token')),
    authKind: 'api-key',
    account: null,
    scopes: '[]',
    capabilities: '{}',
    config: options.config ?? '{}',
    status: options.status ?? 'connected',
    lastValidatedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  })
}

afterEach(() => connectionProviderRegistry.removeForPlugin(OWNER))

describe('boundProviderProjects', () => {
  it('keeps well-formed entries, trimming and falling back to the id for a label', () => {
    expect(boundProviderProjects([
      { id: ' proj-1 ', label: '  Platform  ' },
      { id: 'proj-2', label: '' },
    ])).toEqual([
      { id: 'proj-1', label: 'Platform' },
      { id: 'proj-2', label: 'proj-2' },
    ])
  })

  it('drops what cannot become a row, and never invents one', () => {
    const overLongId = 'x'.repeat(PROVIDER_PROJECT_LIMITS.maxIdBytes + 1)
    expect(boundProviderProjects([
      { id: '', label: 'blank' },
      { id: '   ', label: 'whitespace' },
      { id: 42, label: 'not a string' },
      { id: overLongId, label: 'too long' },
      'not an object',
      null,
      { id: 'keep', label: 'kept' },
    ])).toEqual([{ id: 'keep', label: 'kept' }])
  })

  it('collapses duplicate ids, which would render as two checkboxes over one primary key', () => {
    expect(boundProviderProjects([
      { id: 'proj-1', label: 'First' },
      { id: 'proj-1', label: 'Second' },
    ])).toEqual([{ id: 'proj-1', label: 'First' }])
  })

  it('caps the list and truncates a label rather than trusting a provider for either', () => {
    const many = Array.from({ length: PROVIDER_PROJECT_LIMITS.maxProjects + 25 }, (_, index) => ({ id: `p${index}`, label: 'x' }))
    expect(boundProviderProjects(many)).toHaveLength(PROVIDER_PROJECT_LIMITS.maxProjects)

    const [bounded] = boundProviderProjects([{ id: 'p', label: 'y'.repeat(PROVIDER_PROJECT_LIMITS.maxLabelBytes + 40) }])
    expect(bounded!.label).toHaveLength(PROVIDER_PROJECT_LIMITS.maxLabelBytes)
  })

  it('treats a non-array claim as no projects rather than throwing into the route', () => {
    expect(boundProviderProjects(undefined)).toEqual([])
    expect(boundProviderProjects({ projects: [] })).toEqual([])
  })
})

describe('listConnectionProjects', () => {
  it('runs the provider source inside the secret scope and bounds what it returns', async () => {
    const testDb = makeTestDb()
    const seen: string[] = []
    register('tracker-a', {
      list: ({ connection, secret }) => {
        seen.push(`${connection.id}:${secret}`)
        return Promise.resolve([{ id: 'proj-1', label: 'Platform' }, { id: '', label: 'dropped' }] as ProviderProject[])
      },
    })
    await seedConnection(testDb, { id: 'connection-1', provider: 'tracker-a' })

    const result = await listConnectionProjects({ db: testDb.db, userId: USER, secrets: SECRETS, connectionId: 'connection-1' })

    expect(result).toEqual({ ok: true, value: [{ id: 'proj-1', label: 'Platform' }] })
    expect(seen).toEqual(['connection-1:live-token'])
    testDb.cleanup()
  })

  it('refuses a connection the caller does not own', async () => {
    const testDb = makeTestDb()
    register('tracker-a', { list: () => Promise.resolve([{ id: 'proj-1', label: 'Platform' }]) })
    await seedConnection(testDb, { id: 'connection-1', provider: 'tracker-a' })

    const result = await listConnectionProjects({ db: testDb.db, userId: 'someone-else', secrets: SECRETS, connectionId: 'connection-1' })

    expect(result).toEqual({ ok: false, failure: { error: 'provider_not_connected', status: 403 } })
    testDb.cleanup()
  })

  it('reports a provider that declared no project source as a misconfiguration, not a user error', async () => {
    const testDb = makeTestDb()
    register('tracker-quiet')
    await seedConnection(testDb, { id: 'connection-1', provider: 'tracker-quiet' })

    const result = await listConnectionProjects({ db: testDb.db, userId: USER, secrets: SECRETS, connectionId: 'connection-1' })

    expect(result).toEqual({ ok: false, failure: { error: 'provider_bad_config', status: 502 } })
    testDb.cleanup()
  })

  it('never calls out for a connection awaiting re-auth or turned off', async () => {
    const testDb = makeTestDb()
    let calls = 0
    const source: ProviderProjectSource = {
      list: () => {
        calls++
        return Promise.resolve([])
      },
    }
    register('tracker-a', source)
    register('tracker-b', source)
    await seedConnection(testDb, { id: 'stale', provider: 'tracker-a', status: 'needs-auth' })
    await seedConnection(testDb, { id: 'off', provider: 'tracker-b', status: 'disabled' })

    const stale = await listConnectionProjects({ db: testDb.db, userId: USER, secrets: SECRETS, connectionId: 'stale' })
    const off = await listConnectionProjects({ db: testDb.db, userId: USER, secrets: SECRETS, connectionId: 'off' })

    expect(stale).toEqual({ ok: false, failure: { error: 'provider_needs_auth', status: 401 } })
    expect(off).toEqual({ ok: false, failure: { error: 'provider_not_connected', status: 403 } })
    expect(calls).toBe(0)
    testDb.cleanup()
  })

  it('maps a provider error to its own status, and a bare throw to provider_unavailable', async () => {
    const testDb = makeTestDb()
    register('tracker-a', { list: () => Promise.reject(new ProviderOperationError('provider_needs_auth', 401)) })
    register('tracker-b', { list: () => Promise.reject(new ProviderOperationError('provider_bad_config', 400)) })
    register('tracker-c', { list: () => Promise.reject(new Error('socket hang up')) })
    await seedConnection(testDb, { id: 'a', provider: 'tracker-a' })
    await seedConnection(testDb, { id: 'b', provider: 'tracker-b' })
    await seedConnection(testDb, { id: 'c', provider: 'tracker-c' })

    const run = (connectionId: string) => listConnectionProjects({ db: testDb.db, userId: USER, secrets: SECRETS, connectionId })

    expect(await run('a')).toEqual({ ok: false, failure: { error: 'provider_needs_auth', status: 401 } })
    // A provider rejecting its own request is this node's problem; 400 must not reach the client.
    expect(await run('b')).toEqual({ ok: false, failure: { error: 'provider_bad_config', status: 502 } })
    expect(await run('c')).toEqual({ ok: false, failure: { error: 'provider_unavailable', status: 502 } })
    testDb.cleanup()
  })

  it('records needs-auth when the credential cannot be read, so Settings agrees with the picker', async () => {
    const testDb = makeTestDb()
    register('tracker-a', { list: () => Promise.resolve([{ id: 'proj-1', label: 'Platform' }]) })
    await seedConnection(testDb, { id: 'connection-1', provider: 'tracker-a', authRef: 'not-a-sealed-secret' })

    const result = await listConnectionProjects({ db: testDb.db, userId: USER, secrets: SECRETS, connectionId: 'connection-1' })

    expect(result).toEqual({ ok: false, failure: { error: 'provider_secret_unreadable', status: 401 } })
    const [row] = await testDb.db.select().from(schema.integrations).where(eq(schema.integrations.id, 'connection-1'))
    expect(row?.status).toBe('needs-auth')
    expect(row?.lastError).toBe('provider_secret_unreadable')
    testDb.cleanup()
  })

  it('advertises the source on the public descriptor only when one was declared', () => {
    expect(provider('tracker-a', { list: () => Promise.resolve([]) }).toPublic().supportsProjects).toBe(true)
    expect(provider('tracker-quiet').toPublic().supportsProjects).toBeUndefined()
  })
})
