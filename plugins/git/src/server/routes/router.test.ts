import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { BridgeError, type AppEnv } from '@acorn/plugin-api/node'
import { gitRouter } from './router'

it('answers a mounted refusal with its own status instead of the app backstop', async () => {
  const routes = gitRouter()
    .get('/refused', () => { throw new BridgeError(409, 'dirty_checkout', 'Target checkout has changes.') })
    .get('/broken', () => { throw new Error('unexpected') })
  const app = new Hono<AppEnv>().route('/', routes).onError((_, c) => c.json({ error: { code: 'internal' } }, 500))
  const refused = await app.request('/refused')
  expect(refused.status).toBe(409)
  expect(await refused.json()).toMatchObject({ error: { code: 'dirty_checkout', message: 'Target checkout has changes.' } })
  expect((await app.request('/broken')).status).toBe(500)
})
