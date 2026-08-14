import { makeTestPluginDb, testSecretEnv, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import { gh } from '..'
import type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
import { prCreate } from './prCreate'
import { testGate } from '@acorn/node-core/testkit/auth.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

vi.mock('..', async (importOriginal) => {
  const actual = await importOriginal<typeof import('..')>()
  return { ...actual, gh: vi.fn() }
})

const PRINCIPAL: Principal = { kind: 'device', userId: 'james', deviceId: 'd1' }

// TWO handles, for two different tables in two different files, which is the shape every github route
// test has now:
//   - `plugin.db` is this plugin's migrated github.sqlite, which the router is a factory over. None of
//     the paths asserted below reach it (each returns before the sync-state bust), but it is a real
//     migrated handle rather than a stub so the router cannot silently stop touching it unnoticed.
//   - `env.DB` is CORE's, because the stored GitHub credential lives in core's `integrations` table and
//     is read through the core seam. Returning no rows is the not-connected path; the token's value is
//     irrelevant here because gh() itself is mocked.
const noIntegrations = {
  select: () => ({ from: () => ({ where: async () => [] }) }),
  delete: () => ({ where: async () => undefined }),
} as unknown as Env['DB']

let plugin: TestPluginDb

const post = (principal: Principal | null, body: unknown) => {
  const app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/repos', prCreate(plugin.db))
  return app.fetch(
    new Request('http://acorn.test/api/repos/acme/widget/pulls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: noIntegrations, ...testSecretEnv('0'.repeat(64)) } as Env,
  )
}

describe('prCreate auth + ApiError envelope', () => {
  beforeEach(() => {
    plugin = makeTestPluginDb('github')
    vi.mocked(gh).mockReset()
  })
  afterEach(() => plugin.cleanup())

  it('401s (ApiError) when logged out', async () => {
    const res = await post(null, { title: 't', base: 'main', head: 'feat' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'unauthenticated' })
  })

  it('bad_request (ApiError) on missing fields, before any GitHub call', async () => {
    const res = await post(PRINCIPAL, {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'bad_request' })
    expect(gh).not.toHaveBeenCalled()
  })

  it("folds GitHub's 422 prose into the envelope message with a stable validation_failed code", async () => {
    vi.mocked(gh).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Validation Failed', errors: [{ message: 'A pull request already exists for acme:feat.' }] }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const res = await post(PRINCIPAL, { title: 't', base: 'main', head: 'feat' })
    expect(res.status).toBe(422)
    expect(((await res.json()) as ApiError).error).toMatchObject({
      code: 'validation_failed',
      message: 'A pull request already exists for acme:feat.',
    })
  })
})
