import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
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
    expect(await response.json()).toMatchObject({ principal: { kind: 'internal', userId: 'bob' } })
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

  // A cookie used to be a third way in, and it was the only credential the middleware could WRITE the
  // identity binding from. Both are gone: there is no cookie to present, and the binding is written when
  // a provider account is connected instead.
  it('ignores a cookie entirely', async () => {
    const set = vi.fn()
    const response = await app.fetch(
      new Request('http://acorn.test/', { headers: { cookie: 'session=anything-at-all' } }),
      {
        INTERNAL_TOKEN: 'internal',
        ACTIVE_IDENTITY: { get: () => 'bob', set, clear: vi.fn() },
        SESSION_ENC_KEY: ENC_KEY,
      } as unknown as Env,
    )

    expect(await response.json()).toEqual({ principal: null })
    expect(set).not.toHaveBeenCalled()
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
    // No GitHub token on the principal: a device is an identity, and the credential lives in a stored
    // integration the github plugin reads through its own accessor.
    expect(await response.json()).toMatchObject({
      principal: { kind: 'device', userId: 'bob', deviceId: 'dev-1' },
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

  // A rejected bearer is a rejection, not an invitation to try the next mechanism — so a caller cannot
  // present a bad device token alongside a valid internal token and be admitted as the machine.
  it('does not fall back to the internal token when a presented bearer fails', async () => {
    const response = await app.fetch(
      new Request('http://acorn.test/', {
        headers: { authorization: 'Bearer revoked', 'x-acorn-internal': 'internal' },
      }),
      envWith({ authenticate: vi.fn().mockResolvedValue(null) }),
    )
    expect(await response.json()).toEqual({ principal: null })
  })
})
