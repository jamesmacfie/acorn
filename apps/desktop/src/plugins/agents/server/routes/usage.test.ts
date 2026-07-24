import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { requireUser } from '../../../../core/server/middleware/requireUser'
import type { AgentUsageSnapshot } from '../../shared/usage'
import { agentUsage, setAgentUsageBridge } from './usage'

const snapshot: AgentUsageSnapshot = { providers: [], refreshedAt: 123 }
const request = (path: string, method = 'GET') => new Request(`http://acorn.test${path}`, { method })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } })
    await next()
  })
  return app.route('/api/agents', agentUsage)
}

const gated = () => new Hono<AppEnv>().use('/api/*', requireUser).route('/api/agents', agentUsage)

describe('agent usage routes', () => {
  afterEach(() => setAgentUsageBridge(null))

  it('reads cached usage and forces refresh through the typed bridge', async () => {
    const calls: Array<{ force?: boolean } | undefined> = []
    setAgentUsageBridge({
      read: async (options) => {
        calls.push(options)
        return snapshot
      },
    })
    const app = authed()
    expect(await (await app.fetch(request('/api/agents/usage'), {} as Env)).json()).toEqual(snapshot)
    expect(await (await app.fetch(request('/api/agents/usage/refresh', 'POST'), {} as Env)).json()).toEqual(snapshot)
    expect(calls).toEqual([undefined, { force: true }])
  })

  it('401s without a principal', async () => {
    setAgentUsageBridge({ read: async () => snapshot })
    expect((await gated().fetch(request('/api/agents/usage'), {} as Env)).status).toBe(401)
  })

  it('503s when the bridge is not wired', async () => {
    const response = await authed().fetch(request('/api/agents/usage'), {} as Env)
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe('bridge-unavailable')
  })

  it('returns provider-local error rows as a successful response', async () => {
    setAgentUsageBridge({
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
})
