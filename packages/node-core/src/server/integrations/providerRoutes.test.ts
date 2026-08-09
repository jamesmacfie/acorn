import { afterEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { schema } from '../db'
import { SecretService } from '../../main/core/secrets'
import type { Env } from '../../main/bindings'
import { makeTestDb } from '../../testkit/db'
import { testGate } from '../../testkit/auth'
import type { AppEnv, Principal } from '../middleware/auth'
import { connectionProviderRegistry } from './connectionRegistry'
import { defaultBudgets, externalIdsFor, publicProvider } from './providers/shared'
import { integrationProviderRegistry } from './registry'
import { runProviderResource } from './resourceRuntime'
import { buildIntegrationProviderRoutes } from './providerRoutes'
import { pluginRequestContext } from '../plugin/requestContext'

const OWNER = 'portable-tracker'
const PROVIDER = 'portable-tracker-provider'
const FOREIGN_OWNER = 'other-tracker'
const FOREIGN_PROVIDER = 'other-tracker-provider'
const USER = 'owner-1'
const SECRETS = new SecretService('24'.repeat(32))

const provider = (id: string) => publicProvider({
  id,
  label: 'Portable tracker',
  glyph: 'T',
  kind: 'issue-tracker',
  connection: {
    authKind: 'api-key' as const,
    fields: [],
    connectable: true,
    disconnectable: true,
    async validate() { return 'secret' },
    normalize(_credentials, secret) {
      return { secret, label: 'Portable tracker', account: null, scopes: [], config: {}, capabilities: {} }
    },
    async test() { return { ok: true as const } },
  },
  externalIds: externalIdsFor(id),
  capabilities: { browse: true },
  resources: [{
    id: 'items',
    ttlMs: 60_000,
    merge: 'replace' as const,
    key: (connectionId: string) => `${id}:${connectionId}:items`,
    read: async () => ({ data: { items: ['one'] }, fetchedAt: Date.now() }),
    refresh: async () => ({ ok: true as const }),
  }],
  budgets: defaultBudgets,
  memory: { linkedItems: false, mutations: [], triggers: [], summarize: 'none' as const, acceptedWrites: false },
})

const register = (id: string, owner: string): void => {
  const contribution = provider(id)
  connectionProviderRegistry.register(contribution, owner)
  integrationProviderRegistry.register(contribution, owner)
}

const app = (principal: Principal) => new Hono<AppEnv>()
  .use('/v2/*', ...testGate(principal))
  .route('/v2/p', buildIntegrationProviderRoutes())

afterEach(() => {
  integrationProviderRegistry.removeForPlugin(OWNER)
  integrationProviderRegistry.removeForPlugin(FOREIGN_OWNER)
  connectionProviderRegistry.removeForPlugin(OWNER)
  connectionProviderRegistry.removeForPlugin(FOREIGN_OWNER)
})

describe('portable provider routes', () => {
  it('mounts a fetch handler and preserves the provider-credential gate', async () => {
    register(PROVIDER, OWNER)
    integrationProviderRegistry.registerRoute({
      providerId: PROVIDER,
      prefix: '',
      fetch: (_request, context) => Response.json({ userId: context.userId }),
    })

    const device = await app({ kind: 'device', userId: USER, deviceId: 'device-1' })
      .fetch(new Request(`http://acorn.test/v2/p/${PROVIDER}`), {} as Env)
    expect(device.status).toBe(200)
    expect(await device.json()).toEqual({ userId: USER })

    const task = await app({ kind: 'internal', userId: USER, scope: 'task', taskId: 'task-1' })
      .fetch(new Request(`http://acorn.test/v2/p/${PROVIDER}`), {} as Env)
    expect(task.status).toBe(403)
  })

  it('refuses another plugin provider through the request runtime', async () => {
    register(PROVIDER, OWNER)
    register(FOREIGN_PROVIDER, FOREIGN_OWNER)

    const probe = new Hono<AppEnv>()
      .use('*', ...testGate({ kind: 'device', userId: USER, deviceId: 'device-1' }))
      .get('/', async (c) => {
        try {
          await pluginRequestContext(c, OWNER).providers.connections(FOREIGN_PROVIDER)
          return c.text('unexpected')
        } catch (error) {
          return c.text(error instanceof Error ? error.message : String(error), 403)
        }
      })

    const response = await probe.fetch(new Request('http://acorn.test/'), {} as Env)
    expect(response.status).toBe(403)
    expect(await response.text()).toContain(`Plugin '${OWNER}' cannot use integration provider '${FOREIGN_PROVIDER}'`)
  })

  it('returns the same resource result as the built-in portable core', async () => {
    register(PROVIDER, OWNER)
    const testDb = makeTestDb()
    const now = Date.now()
    const authRef = await SECRETS.seal('secret')
    const connectionId = 'connection-1'
    await testDb.db.insert(schema.integrations).values({
      id: connectionId,
      userId: USER,
      provider: PROVIDER,
      label: 'Portable tracker',
      authRef,
      authKind: 'api-key',
      account: null,
      scopes: '[]',
      capabilities: '{}',
      config: '{}',
      status: 'connected',
      lastValidatedAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    const args = { providerId: PROVIDER, connectionId, resourceId: 'items', input: {} }
    const expected = await runProviderResource({ db: testDb.db, userId: USER, secrets: SECRETS, ...args })

    const probe = new Hono<AppEnv>()
      .use('*', ...testGate({ kind: 'device', userId: USER, deviceId: 'device-1' }))
      .get('/', async (c) => c.json(await pluginRequestContext(c, OWNER).providers.resource(args)))
    const actual = await probe.fetch(new Request('http://acorn.test/'), {
      DB: testDb.db,
      SECRETS,
    } as unknown as Env)

    expect(await actual.json()).toEqual(expected)
    testDb.cleanup()
  })
})
