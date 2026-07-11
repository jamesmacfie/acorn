import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { makeTestDb, type TestDb } from '../routes/testDb'
import { createAutomationApp } from './app'
import type { ApiSettingsController, CoreSystemDeps } from './coreSystem'
import { buildCoreSystemContribution } from './coreSystem'
import { defineEndpoint } from './defineEndpoint'
import { IdempotencyStore } from './idempotency'
import { AutomationApiRegistry } from './registry'
import { TokenService } from './tokenService'

const HOST = '127.0.0.1:4318'

const settingsStub: ApiSettingsController = {
  read: () => ({ enabled: true, port: 4318, effectivePort: 4318, bindAddress: HOST, portOverridden: false }),
  patch: async () => ({ enabled: true, port: 4318, effectivePort: 4318, bindAddress: HOST, portOverridden: false, rebound: false }),
}

function makeApp(tokens: TokenService, db: TestDb['db']) {
  const registry = new AutomationApiRegistry()
  const coreDeps: CoreSystemDeps = {
    runtime: {
      version: '1.2.3',
      startedAt: 1000,
      desktop: true,
      reconciliationComplete: () => true,
      rendererConnected: () => false,
      terminalAvailable: () => true,
      worktreesAvailable: () => true,
      pluginCapabilities: () => [],
      shuttingDown: () => false,
    },
    settings: settingsStub,
    getSnapshot: () => registry.freeze(),
  }
  registry.registerContribution(buildCoreSystemContribution(coreDeps), 'core')
  // a write endpoint that echoes a counter, with idempotency, to test scope + replay
  registry.registerEndpoint(
    defineEndpoint({
      operationId: 'core.echo.create',
      pluginId: 'core',
      method: 'POST',
      path: '/echo',
      scope: 'write',
      risk: 'write',
      summary: 'echo',
      idempotency: 'optional',
      body: z.strictObject({ value: z.string().min(1) }),
      response: z.strictObject({ id: z.string(), value: z.string() }),
      status: 201,
      handler: async (_ctx, { body }) => ({ id: 'e1', value: body.value }),
    }),
  )
  return createAutomationApp({
    snapshot: registry.freeze(),
    tokens,
    idempotency: new IdempotencyStore(db),
    allowedHost: HOST,
  })
}

describe('createAutomationApp', () => {
  let t: TestDb
  let app: ReturnType<typeof createAutomationApp>
  let readToken: string
  let writeToken: string

  beforeEach(async () => {
    t = makeTestDb()
    const tokens = new TokenService(t.db)
    readToken = (await tokens.create({ userId: 'u', name: 'r', scopes: ['read'], expiresAt: null })).token
    writeToken = (await tokens.create({ userId: 'u', name: 'w', scopes: ['read', 'write'], expiresAt: null })).token
    app = makeApp(tokens, t.db)
  })
  afterEach(() => t.cleanup())

  const req = (path: string, init: RequestInit = {}, token?: string) => {
    const headers = new Headers(init.headers)
    headers.set('host', HOST)
    if (token) headers.set('authorization', `Bearer ${token}`)
    return app.fetch(new Request(`http://${HOST}${path}`, { ...init, headers }), {} as Env)
  }

  it('rejects wrong Host before routing', async () => {
    const res = await app.fetch(new Request('http://evil.test/api/v1/health', { headers: { host: 'evil.test' } }), {} as Env)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden_host')
  })

  it('returns 401 invalid_token with WWW-Authenticate when no/invalid bearer', async () => {
    const res = await req('/api/v1/health')
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('invalid_token')
    expect((await res.json()).error.code).toBe('invalid_token')
    expect((await (await req('/api/v1/health', {}, 'bogus')).json()).error.code).toBe('invalid_token')
  })

  it('serves an enveloped, request-id-echoing health payload to a read token', async () => {
    const res = await req('/api/v1/health', { headers: { 'x-request-id': 'abc123' } }, readToken)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('abc123')
    const body = await res.json()
    expect(body.requestId).toBe('abc123')
    expect(body.data.version).toBe('1.2.3')
    expect(body.data.status).toBe('ready')
    expect(body.data.apiVersion).toBe('v1')
  })

  it('reports the resolved principal without any secret', async () => {
    const res = await req('/api/v1/principal', {}, readToken)
    const body = await res.json()
    expect(body.data.scopes).toEqual(['read'])
    expect(JSON.stringify(body)).not.toContain('secretHash')
  })

  it('gates write endpoints: read → 403 insufficient_scope, write → 201', async () => {
    const denied = await req('/api/v1/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'hi' }),
    }, readToken)
    expect(denied.status).toBe(403)
    expect((await denied.json()).error.code).toBe('insufficient_scope')

    const ok = await req('/api/v1/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'hi' }),
    }, writeToken)
    expect(ok.status).toBe(201)
    expect(ok.headers.get('location')).toBe('/api/v1/echo/e1')
    expect((await ok.json()).data).toEqual({ id: 'e1', value: 'hi' })
  })

  it('validates media type, JSON, and unknown fields', async () => {
    const media = await req('/api/v1/echo', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }, writeToken)
    expect(media.status).toBe(415)

    const malformed = await req('/api/v1/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, writeToken)
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error.code).toBe('malformed_json')

    const unknown = await req('/api/v1/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'hi', extra: 1 }),
    }, writeToken)
    expect(unknown.status).toBe(422)
    expect((await unknown.json()).error.code).toBe('validation_failed')
  })

  it('replays an idempotent request and conflicts on a changed body', async () => {
    const send = (body: unknown, key: string) =>
      req('/api/v1/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(body),
      }, writeToken)

    const first = await send({ value: 'a' }, 'k1')
    expect(first.status).toBe(201)
    const replay = await send({ value: 'a' }, 'k1')
    expect(replay.status).toBe(201)
    expect(await replay.json()).toEqual(await first.clone().json())

    const conflict = await send({ value: 'b' }, 'k1')
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error.code).toBe('idempotency_conflict')
  })

  it('serves a bearer-gated OpenAPI document covering registered operations', async () => {
    const res = await req('/api/v1/openapi.json', {}, readToken)
    const doc = await res.json()
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.paths['/api/v1/health']).toBeDefined()
    expect(doc.paths['/api/v1/echo'].post['x-acorn-scope']).toBe('write')
  })

  it('404s an unknown endpoint with endpoint_not_found', async () => {
    const res = await req('/api/v1/nope', {}, readToken)
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('endpoint_not_found')
  })
})
