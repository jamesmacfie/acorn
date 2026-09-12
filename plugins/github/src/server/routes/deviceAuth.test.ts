import { makeTestDb, schema, testGate, testSecretEnv, type TestDb } from '@acorn/plugin-api/testkit'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
import type { Env } from '@acorn/node-core/server/bindings.ts'
// Core's schema: the device flow writes core's `integrations` row through core's own
// connectProvider and touches none of this plugin's tables, so this test needs core's handle only.
import { decryptSecret } from '@acorn/node-core/server/secretBox.ts'
import { githubDeviceAuth } from './deviceAuth'
import { githubProvider } from '../provider'
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations/connectionRegistry.ts'

const ENC_KEY = '0'.repeat(64)
const PRINCIPAL: Principal = { kind: 'device', deviceId: 'd1', userId: 'james' }

let harness: TestDb
const fetchMock = vi.fn()

beforeEach(() => {
  harness = makeTestDb()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  if (!connectionProviderRegistry.get('github')) connectionProviderRegistry.register(githubProvider)
})

afterEach(() => {
  vi.unstubAllGlobals()
  harness.cleanup()
})

const env = () =>
  ({
    DB: harness.db,
    ...testSecretEnv(ENC_KEY),
  }) as unknown as Env

const post = (path: string, body?: unknown, principal: Principal = PRINCIPAL) => {
  const app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/github', githubDeviceAuth(() => 'client-id'))
  return app.fetch(
    new Request(`http://acorn.test/api/github${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
    env(),
  )
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })

describe('github device flow — start', () => {
  it('returns the code, where to enter it, and the poll interval', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ device_code: 'dc', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 899, interval: 5 }),
    )
    const res = await post('/auth/device/start')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      deviceCode: 'dc',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 899,
      interval: 5,
    })
    // The whole point of the device grant: no client secret is ever sent.
    const [, init] = fetchMock.mock.calls[0]
    expect(String(init.body)).not.toContain('client_secret')
    expect(String(init.body)).toContain('client_id=client-id')
  })

  it('surfaces an unusable GitHub response as provider_unavailable', async () => {
    fetchMock.mockResolvedValueOnce(json({ device_code: 'dc' })) // no user_code / verification_uri
    const res = await post('/auth/device/start')
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('provider_unavailable')
  })
})

describe('github device flow — poll', () => {
  const pollBody = { deviceCode: 'dc' }

  it('reports pending without treating it as an error', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'authorization_pending' }))
    const res = await post('/auth/device/poll', pollBody)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'pending', slowDown: false })
  })

  it('passes slow_down through so the client can back off', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'slow_down' }))
    expect(await (await post('/auth/device/poll', pollBody)).json()).toEqual({ status: 'pending', slowDown: true })
  })

  it('reports the terminal outcomes distinctly', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'access_denied' }))
    expect(await (await post('/auth/device/poll', pollBody)).json()).toEqual({ status: 'denied' })
    fetchMock.mockResolvedValueOnce(json({ error: 'expired_token' }))
    expect(await (await post('/auth/device/poll', pollBody)).json()).toEqual({ status: 'expired' })
  })

  it('stores the token encrypted and records the granted scopes', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'gho_realtoken' })) // token exchange
      .mockResolvedValueOnce(json({ login: 'james', name: 'James', avatar_url: null }, { headers: { 'x-oauth-scopes': 'repo, read:org' } }))

    const res = await post('/auth/device/poll', pollBody)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; integration: { label: string; scopes: string[] } }
    expect(body.status).toBe('connected')
    expect(body.integration.label).toBe('james')
    expect(body.integration.scopes).toEqual(['repo', 'read:org'])

    const [row] = await harness.db.select().from(schema.integrations)
    expect(row.provider).toBe('github')
    expect(row.userId).toBe('james')
    // At rest it is ciphertext, and the plaintext round-trips only under the right key.
    expect(row.authRef).not.toContain('gho_realtoken')
    expect(await decryptSecret(row.authRef, ENC_KEY)).toBe('gho_realtoken')
  })

  it('never echoes the access token back to the client', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'gho_realtoken' }))
      .mockResolvedValueOnce(json({ login: 'james', name: null, avatar_url: null }, { headers: { 'x-oauth-scopes': 'repo' } }))
    expect(await (await post('/auth/device/poll', pollBody)).text()).not.toContain('gho_realtoken')
  })

  it('rejects a rejected token rather than storing it', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'gho_bad' }))
      .mockResolvedValueOnce(json({ message: 'Bad credentials' }, { status: 401 }))
    const res = await post('/auth/device/poll', pollBody)
    expect(res.status).toBe(401)
    expect(await harness.db.select().from(schema.integrations)).toHaveLength(0)
  })

  it('requires a deviceCode', async () => {
    const res = await post('/auth/device/poll', {})
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// This plugin registers with `prefix: ''`, so these paths sit at /v2/p/github/auth/device/* where no
// core mount gate reaches them and the router has to carry its own. Without it a task-scoped agent
// token could open a device window, show the owner a code for an account the agent controls, and end
// up with that account's token stored as the owner's GitHub connection: every later GitHub call made
// on the attacker's behalf.
describe('github device flow — who may open one', () => {
  it('refuses both halves to a task-scoped agent token, before any call to GitHub', async () => {
    const agent: Principal = { kind: 'internal', userId: 'james', scope: 'task', taskId: 'task-1' }
    for (const path of ['/auth/device/start', '/auth/device/poll']) {
      const res = await post(path, { deviceCode: 'dc' }, agent)
      expect(res.status, path).toBe(403)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
