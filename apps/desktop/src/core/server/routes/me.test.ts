import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { ApiError, Me } from '../../shared/api'
import type { AppEnv, Principal, SessionUser } from '../middleware/auth'
import { me } from './me'
import { testGate } from './testAuth'

const USER: SessionUser = { token: 'gh-token', login: 'james', name: 'James', avatar: 'a.png', scopes: ['repo'] }

// Build the route behind the real requireUser gate. `principal` null => logged-out.
const app = (principal: Principal | null) => new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/me', me)

const get = (principal: Principal | null) => app(principal).fetch(new Request('http://acorn.test/api/me'), {} as Env)

describe('GET /api/me', () => {
  it('returns the public user projection (no token)', async () => {
    const res = await get({ kind: 'user', user: USER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Me
    expect(body).toEqual({ login: 'james', name: 'James', avatar: 'a.png', scopes: ['repo'] })
    expect(body).not.toHaveProperty('token')
  })

  it('401s with the ApiError envelope when no principal is resolved', async () => {
    const res = await get(null)
    expect(res.status).toBe(401)
    expect((await res.json()) as ApiError).toEqual({ error: 'unauthenticated' })
  })
})
