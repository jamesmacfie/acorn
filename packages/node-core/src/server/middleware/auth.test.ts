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
