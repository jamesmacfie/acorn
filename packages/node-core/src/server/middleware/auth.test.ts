import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { sealSession, SESSION_COOKIE } from '../session'
import { authMiddleware, type AppEnv } from './auth'
import type { Env } from '../../main/bindings'

const ENC_KEY = '0'.repeat(64)

const app = new Hono<AppEnv>()
  .use('*', authMiddleware)
  .get('/', (c) => c.json({ principal: c.get('principal') }))

describe('machine identity binding', () => {
  it('maps the internal token to the explicit active identity without querying cached rows', async () => {
    const response = await app.fetch(
      new Request('http://acorn.test/', { headers: { 'x-acorn-internal': 'internal' } }),
      {
        INTERNAL_TOKEN: 'internal',
        ACTIVE_IDENTITY: { get: () => 'bob', set: vi.fn(), clear: vi.fn() },
        SESSION_ENC_KEY: ENC_KEY,
      } as unknown as Env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ principal: { kind: 'internal', user: { login: 'bob', token: '' } } })
  })

  it('fails closed for internal traffic when no identity is bound', async () => {
    const response = await app.fetch(
      new Request('http://acorn.test/', { headers: { 'x-acorn-internal': 'internal' } }),
      {
        INTERNAL_TOKEN: 'internal',
        ACTIVE_IDENTITY: { get: () => null, set: vi.fn(), clear: vi.fn() },
        SESSION_ENC_KEY: ENC_KEY,
      } as unknown as Env,
    )

    expect(await response.json()).toEqual({ principal: null })
  })

  // Surrounding whitespace is not in this list: HTTP trims header values, so 'internal ' arrives as
  // 'internal' and matching it is correct.
  it('rejects an internal token that differs only in length or content', async () => {
    for (const presented of ['interna', 'internalx', 'INTERNAL', '']) {
      const response = await app.fetch(new Request('http://acorn.test/', { headers: { 'x-acorn-internal': presented } }), {
        INTERNAL_TOKEN: 'internal',
        ACTIVE_IDENTITY: { get: () => 'bob', set: vi.fn(), clear: vi.fn() },
        SESSION_ENC_KEY: ENC_KEY,
      } as unknown as Env)
      expect(await response.json()).toEqual({ principal: null })
    }
  })

  it('updates the binding from a valid cookie session', async () => {
    const set = vi.fn()
    const sealed = await sealSession({ token: 'github', login: 'alice', name: '', avatar: '', scopes: [] }, ENC_KEY)
    const response = await app.fetch(
      new Request('http://acorn.test/', { headers: { cookie: `${SESSION_COOKIE}=${sealed}` } }),
      {
        INTERNAL_TOKEN: 'internal',
        ACTIVE_IDENTITY: { get: () => 'bob', set, clear: vi.fn() },
        SESSION_ENC_KEY: ENC_KEY,
      } as unknown as Env,
    )

    expect(response.status).toBe(200)
    expect(set).toHaveBeenCalledWith('alice')
  })
})

describe('device bearer', () => {
  const envWith = (devices: Partial<Env['DEVICES']>, identity: string | null = 'bob') =>
    ({
      INTERNAL_TOKEN: 'internal',
      ACTIVE_IDENTITY: { get: () => identity, set: vi.fn(), clear: vi.fn() },
      SESSION_ENC_KEY: ENC_KEY,
      DEVICES: devices,
    }) as unknown as Env

  const withBearer = (value: string, env: Env) =>
    app.fetch(new Request('http://acorn.test/', { headers: { authorization: value } }), env)

  it('resolves a paired device token to a device principal', async () => {
    const authenticate = vi.fn().mockResolvedValue({ deviceId: 'dev-1' })
    const response = await withBearer('Bearer acorn_dt_token', envWith({ authenticate }))

    expect(authenticate).toHaveBeenCalledWith('acorn_dt_token')
    // token: '' — the GitHub credential is not the session any more; the github plugin reads it from
    // a stored integration rather than off the principal.
    expect(await response.json()).toMatchObject({
      principal: { kind: 'device', deviceId: 'dev-1', user: { login: 'bob', token: '' } },
    })
  })

  it('resolves no principal when the device is unknown or revoked', async () => {
    const response = await withBearer('Bearer acorn_dt_token', envWith({ authenticate: vi.fn().mockResolvedValue(null) }))
    expect(await response.json()).toEqual({ principal: null })
  })

  // fetch merges repeated headers with ", " and a valid bearer contains no comma, so a comma means
  // more than one Authorization header arrived. That is ambiguous — reject rather than pick one.
  it('rejects duplicate Authorization headers rather than choosing one', async () => {
    const authenticate = vi.fn().mockResolvedValue({ deviceId: 'dev-1' })
    const response = await withBearer('Bearer good, Bearer evil', envWith({ authenticate }))
    expect(authenticate).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ principal: null })
  })

  it('ignores non-bearer authorization schemes', async () => {
    const authenticate = vi.fn().mockResolvedValue({ deviceId: 'dev-1' })
    const response = await withBearer('Basic dXNlcjpwYXNz', envWith({ authenticate }))
    expect(authenticate).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ principal: null })
  })

  // Bearer resolves ahead of the cookie, so the cookie branch becomes dead code the moment the
  // client stops sending one — which is how it gets deleted safely.
  it('prefers the bearer over a valid cookie', async () => {
    const sealed = await sealSession({ token: 'github', login: 'alice', name: '', avatar: '', scopes: [] }, ENC_KEY)
    const response = await app.fetch(
      new Request('http://acorn.test/', {
        headers: { authorization: 'Bearer acorn_dt_token', cookie: `${SESSION_COOKIE}=${sealed}` },
      }),
      envWith({ authenticate: vi.fn().mockResolvedValue({ deviceId: 'dev-1' }) }),
    )
    expect(await response.json()).toMatchObject({ principal: { kind: 'device' } })
  })
})
