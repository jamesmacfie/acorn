import { makeTestPluginDb, testGate, testSecretEnv, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import { gh } from '../../githubApi'
import type { AppEnv, Principal } from '@acorn/plugin-api/testkit'
import { prCreate } from './prCreate'
import type { Env } from '@acorn/plugin-api/testkit'
import type { Compare } from '../../../shared/api'

vi.mock('../../githubApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../githubApi')>()
  return { ...actual, gh: vi.fn() }
})

const PRINCIPAL: Principal = { kind: 'device', userId: 'james', deviceId: 'd1' }

// Two handles, for two different tables in two different files, which is the shape every github route
// test has now:
//   `plugin.db` is this plugin's migrated github.sqlite, which the router is a factory over. None of
//     the paths asserted below reach it, each returning before the sync-state bust, but it's a real
//     migrated handle rather than a stub so the router can't silently stop touching it unnoticed.
//   `env.DB` is core's, because the stored GitHub credential lives in core's `integrations` table and is
//     read through the core seam. Returning no rows is the not-connected path, and the token's value is
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

describe('compare preview completeness', () => {
  beforeEach(() => {
    plugin = makeTestPluginDb('github')
    vi.mocked(gh).mockReset()
  })
  afterEach(() => plugin.cleanup())

  const compare = async (fileCount: number) => {
    vi.mocked(gh).mockResolvedValue(new Response(JSON.stringify({
      ahead_by: 2,
      files: Array.from({ length: fileCount }, (_, i) => ({ filename: `f${i}.ts`, status: 'modified', additions: 1, deletions: 0, sha: `s${i}`, patch: '@@' })),
      commits: [],
    }), { headers: { 'content-type': 'application/json' } }))
    const app = new Hono<AppEnv>().use('/api/*', ...testGate(PRINCIPAL)).route('/api/repos', prCreate(plugin.db))
    const res = await app.fetch(new Request('http://acorn.test/api/repos/acme/widget/compare?base=main&head=feat'), { DB: noIntegrations, BLOBS: blobStore(), ...testSecretEnv('0'.repeat(64)) } as Env)
    return (await res.json()) as Compare
  }
  const blobs = new Map<string, string>()
  const blobStore = () => ({ get: async (key: string) => blobs.get(key) ?? null, put: async (key: string, value: string) => void blobs.set(key, value) })

  // GitHub gives compare no total and stops at 300, so 300 files never claims to be all of them.
  it('calls a 300-file comparison capped and a smaller one complete', async () => {
    expect((await compare(300)).completeness).toEqual({ kind: 'incomplete', cause: 'upstream-cap', resource: 'compare-files', received: 300, reportedTotal: null, limit: 300 })
    expect((await compare(12)).completeness).toEqual({ kind: 'complete' })
  })

  // The preview reads segments like a pull's diff: descriptors in the answer, bodies stored by digest.
  it('answers the comparison as a document and stores each patch under its digest', async () => {
    const answer = await compare(3)
    expect(answer.document.files.map((file) => file.path)).toEqual(['f0.ts', 'f1.ts', 'f2.ts'])
    const key = answer.document.files[0]!.patchKey!
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(blobs.get(`patch:${key}`)).toBe('@@')
    expect(JSON.stringify(answer)).not.toContain('"patch"')
  })
})
