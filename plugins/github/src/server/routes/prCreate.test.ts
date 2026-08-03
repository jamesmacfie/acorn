import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import { gh } from '..'
import type { AppEnv, Principal, SessionUser } from '@acorn/node-core/server/middleware/auth.ts'
import { prCreate } from './prCreate'
import { testGate } from '@acorn/node-core/server/routes/testAuth.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

vi.mock('..', async (importOriginal) => {
  const actual = await importOriginal<typeof import('..')>()
  return { ...actual, gh: vi.fn() }
})

const USER: SessionUser = { token: 'gh', login: 'james', name: '', avatar: '', scopes: [] }
const PRINCIPAL: Principal = { kind: 'user', user: USER }

// The route now reads the stored GitHub credential, so it needs a DB. Returning no rows exercises
// the not-connected path and lets the transitional principal-token fallback supply 'gh'.
const noIntegrations = {
  select: () => ({ from: () => ({ where: async () => [] }) }),
  delete: () => ({ where: async () => undefined }),
} as unknown as Env['DB']

const post = (principal: Principal | null, body: unknown) => {
  const app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/repos', prCreate)
  return app.fetch(
    new Request('http://acorn.test/api/repos/acme/widget/pulls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: noIntegrations, SESSION_ENC_KEY: '0'.repeat(64) } as Env,
  )
}

describe('prCreate auth + ApiError envelope', () => {
  beforeEach(() => vi.mocked(gh).mockReset())

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
