import { Hono } from 'hono'
import { expect, it } from 'vitest'
import type { AppEnv } from '../middleware/auth'
import { servePluginFetch } from './fetchRoute'

// The idempotency middleware hashes the body before the route runs, so the forwarded request can't
// reuse the original stream.
it('forwards a body that a middleware already read', async () => {
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('principal', { kind: 'device', deviceId: 'device-1' } as never)
      await c.req.text()
      await next()
    })
    .post('/v1/p/echo/*', (c) => servePluginFetch(c, { pluginId: 'echo', mount: '/v1/p/echo', fetch: async (request) => new Response(await request.text()) }))
  const response = await app.request('/v1/p/echo/save', { method: 'POST', body: '{"on":true}' })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('{"on":true}')
})
