import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { expect, it } from 'vitest'
import { makeTestDb } from '../../testkit/db'
import { idempotencyStore } from '../auth/idempotency'
import type { AppEnv, Principal } from './auth'
import { idempotency } from './idempotency'

// A phone's channel sends a body with no Content-Length, so a body limit after the key check has no
// header to read and streams the body itself. The key check must leave that body unread.
it('leaves the body unread for a body limit with no length to check', async () => {
  const harness = makeTestDb()
  try {
    const app = new Hono<AppEnv>()
      .use(async (c, next) => {
        c.set('principal', { deviceId: 'device-a' } as Principal)
        await next()
      })
      .use(idempotency)
      .use(bodyLimit({ maxSize: 1024 }))
      .post('/turns', async (c) => c.json(await c.req.json()))
    const env = { IDEMPOTENCY: idempotencyStore(harness.db) } as AppEnv['Bindings']
    const key = crypto.randomUUID()
    const send = () =>
      app.request(
        new Request('https://node.test/turns', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': key },
          body: new TextEncoder().encode('{"text":"hi"}'),
        }),
        undefined,
        env,
      )

    const first = await send()
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ text: 'hi' })
    // The same key again replays the stored answer.
    expect(await (await send()).json()).toEqual({ text: 'hi' })
  } finally {
    harness.cleanup()
  }
})
