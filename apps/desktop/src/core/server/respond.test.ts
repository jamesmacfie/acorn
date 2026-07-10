import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it } from 'vitest'
import type { ApiError } from '../shared/api'
import type { AppEnv } from './middleware/auth'
import { onServerError } from './respond'

const app = new Hono<AppEnv>()
  .get('/api/boom', () => {
    throw new Error('db exploded')
  })
  .get('/api/csrf', () => {
    throw new HTTPException(403)
  })
  .get('/page', () => {
    throw new Error('nope')
  })
  .onError(onServerError)

const get = (path: string) => app.fetch(new Request(`http://acorn.test${path}`), {} as Env)

describe('onServerError backstop', () => {
  it('wraps uncaught /api throws in the ApiError envelope', async () => {
    const res = await get('/api/boom')
    expect(res.status).toBe(500)
    expect((await res.json()) as ApiError).toEqual({ error: 'internal', detail: ['db exploded'] })
  })

  it('lets HTTPExceptions keep their own response (csrf 403 stays 403)', async () => {
    const res = await get('/api/csrf')
    expect(res.status).toBe(403)
  })

  it('leaves non-/api throws on the default text response', async () => {
    const res = await get('/page')
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })
})
