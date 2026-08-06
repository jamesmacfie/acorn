import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { SecretService } from '@acorn/node-core/main/core/secrets.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { makeTestDb } from '@acorn/node-core/server/routes/testDb.ts'
import type { AgentUsageSnapshot } from '../../shared/usage'
import { emptyAgentPricingPreferences, type AgentPricingPreferences } from '../../shared/pricing'
import { readAgentPricingPreferences, writeAgentPricingPreferences } from '../../main/pricingStore'
import { agentUsage, setAgentUsageBridge } from './usage'
import type { Env } from '@acorn/node-core/main/bindings.ts'

const snapshot: AgentUsageSnapshot = { providers: [], refreshedAt: 123 }

// The three usage cases only exercise `read`, but the bridge type is complete, so each stub fills the
// pricing halves too. Kept as one helper rather than repeated: a stub that silently answered the built-in
// pricing table would make the persistence case below pass vacuously.
const unusedPricing = {
  pricing: async (): Promise<AgentPricingPreferences> => {
    throw new Error('pricing is not part of this case')
  },
  setPricing: async (): Promise<void> => {
    throw new Error('setPricing is not part of this case')
  },
}
const request = (path: string, method = 'GET', body?: unknown) => new Request(
  `http://acorn.test${path}`,
  {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  },
)

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  return app.route('/api/agents', agentUsage)
}

const gated = () => new Hono<AppEnv>().use('/api/*', requireUser).route('/api/agents', agentUsage)

describe('agent usage routes', () => {
  afterEach(() => setAgentUsageBridge(null))

  it('reads cached usage and forces refresh through the typed bridge', async () => {
    const calls: Array<{ userId: string; force?: boolean }> = []
    setAgentUsageBridge({
      ...unusedPricing,
      read: async (options) => {
        calls.push(options)
        return snapshot
      },
    })
    const app = authed()
    expect(await (await app.fetch(request('/api/agents/usage'), {} as Env)).json()).toEqual(snapshot)
    expect(await (await app.fetch(request('/api/agents/usage/refresh', 'POST'), {} as Env)).json()).toEqual(snapshot)
    expect(calls).toEqual([{ userId: 'james' }, { userId: 'james', force: true }])
  })

  it('401s without a principal', async () => {
    setAgentUsageBridge({ ...unusedPricing, read: async () => snapshot })
    expect((await gated().fetch(request('/api/agents/usage'), {} as Env)).status).toBe(401)
  })

  it('503s when the bridge is not wired', async () => {
    const response = await authed().fetch(request('/api/agents/usage'), {} as Env)
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('bridge-unavailable')
  })

  it('returns provider-local error rows as a successful response', async () => {
    setAgentUsageBridge({
      ...unusedPricing,
      read: async () => ({
        refreshedAt: 1,
        providers: [
          {
            provider: 'claude',
            availability: 'error',
            health: 'unknown',
            plan: null,
            account: null,
            quotas: [],
            cost: null,
            daily: null,
            capturedAt: null,
            stale: false,
            error: { code: 'authentication_required', message: 'Sign in.' },
          },
        ],
      }),
    })
    const response = await authed().fetch(request('/api/agents/usage'), {} as Env)
    expect(response.status).toBe(200)
    expect((await response.json()).providers[0].error.code).toBe('authentication_required')
  })

  // The pricing pane's round trip, now through the bridge rather than `getDb(c.env)`. The bridge is
  // filled the way the plugin's init fills it — over a real CoreServices, whose `prefs` reads and writes
  // core's `prefs` table — so this still asserts against actual persistence rather than a stub's memory.
  // `env` is deliberately empty now: a passing test with no DB on `c.env` is the proof that the route no
  // longer touches core's handle.
  it('reads, validates, and persists plugin-owned pricing preferences', async () => {
    const testDb = makeTestDb()
    try {
      const core = createCoreServices({ secrets: new SecretService('33'.repeat(32)), db: testDb.db })
      setAgentUsageBridge({
        read: async () => snapshot,
        pricing: (userId) => readAgentPricingPreferences(core.prefs, userId),
        setPricing: (userId, preferences) => writeAgentPricingPreferences(core.prefs, userId, preferences),
      })
      const app = authed()
      const env = {} as Env
      const initial = await app.fetch(request('/api/agents/pricing'), env)
      expect(await initial.json()).toEqual(emptyAgentPricingPreferences())

      const preferences = emptyAgentPricingPreferences()
      preferences.claude.customModels.push({
        model: 'claude-future',
        price: { input: 1, output: 2, cacheWrite: 1.25, cacheRead: 0.1 },
      })
      const saved = await app.fetch(request('/api/agents/pricing', 'PUT', preferences), env)
      expect(saved.status).toBe(200)
      expect(await saved.json()).toEqual(preferences)
      expect(await (await app.fetch(request('/api/agents/pricing'), env)).json()).toEqual(preferences)

      const invalid = await app.fetch(request('/api/agents/pricing', 'PUT', {
        version: 1,
        claude: { overrides: [], customModels: [{ model: '', price: {} }] },
      }), env)
      expect(invalid.status).toBe(400)
      expect((await invalid.json()).error.code).toBe('bad_request')
      expect(await (await app.fetch(request('/api/agents/pricing'), env)).json()).toEqual(preferences)
    } finally {
      testDb.cleanup()
    }
  })
})
