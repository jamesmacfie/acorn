import { Hono } from 'hono'
import { expect, it } from 'vitest'
import type { AppEnv } from '@acorn/plugin-api/testkit'
import { cloneLaunchRoutes } from './cloneLaunches'

// The launch rules are in ../runs/cloneLaunch.test.ts. This proves who may call, and the body check.

const deps = {
  db: null as never,
  core: {
    projects: {
      clone: async () => {
        throw new Error('nothing may clone in this test')
      },
    },
  } as never,
  starts: { startById: async () => ({ error: 'unused' }) },
  catalog: () => ({}) as never,
}

const as = (principal: unknown) =>
  new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('principal', principal as never)
      await next()
    })
    .route('/clone-launches', cloneLaunchRoutes(deps))

const post = (body: unknown) =>
  new Request('http://acorn.test/clone-launches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const body = {
  clone: { url: 'https://example.com/acme/api.git', parentDir: '/work' },
  defId: 'repo:security-scan',
  launchId: '4a67745d-e627-478c-93f5-4f0800d37f11',
}

it('refuses task and service credentials, because a clone fetches code onto the Node', async () => {
  for (const scope of ['task', 'service']) {
    const app = as({ kind: 'internal', userId: 'james', scope, taskId: 'task1' })
    expect((await app.fetch(post(body))).status).toBe(403)
    expect((await app.fetch(new Request('http://acorn.test/clone-launches/workflows'))).status).toBe(403)
  }
})

it('refuses a bad body, and answers a committed workflow with 400 before cloning', async () => {
  const app = as({ kind: 'device', userId: 'james' })
  expect((await app.fetch(post({ ...body, launchId: 'not-a-uuid' }))).status).toBe(400)
  const refused = await app.fetch(post(body))
  expect(refused.status).toBe(400)
  expect(JSON.stringify(await refused.json())).toContain('committed in a repository')
  expect((await app.fetch(new Request(`http://acorn.test/clone-launches/${body.launchId}`))).status).toBe(404)
})
