import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Env } from '@acorn/plugin-api/testkit'
import type { PullBatchItem } from '../../../shared/api'
import { fakeGithub, makeFakePull } from '../mirror/fakeGithub.helper'
import { pullsBatch } from './pullsBatch'
import { resolveRepoForUser } from '../mirror/repoMirror'

vi.mock('../mirror/repoMirror', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mirror/repoMirror')>()
  return { ...actual, resolveRepoForUser: vi.fn() }
})
// The credential lives in core's integrations table; these tests are about the mirror, so the token
// is handed over directly and `fetch` is the fake GitHub.
vi.mock('../../githubToken', () => ({ githubToken: async () => 'token' }))

const jsonRequest = (body: unknown) =>
  new Request('http://acorn.test/api/repos/acme/web/pulls/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

let plugin: TestPluginDb
let blobs: Map<string, string>
let app: Hono<AppEnv>
const env = () => ({
  BLOBS: { get: async (k: string) => blobs.get(k) ?? null, put: async (k: string, v: string) => void blobs.set(k, v) },
}) as unknown as Env

describe('pulls batch route', () => {
  beforeEach(() => {
    plugin = makeTestPluginDb('github')
    blobs = new Map()
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    app.route('/api/repos', pullsBatch(plugin.db))
    vi.mocked(resolveRepoForUser).mockResolvedValue({ ok: true, value: { repoId: 19847 } })
  })
  afterEach(() => {
    plugin.cleanup()
    vi.unstubAllGlobals()
  })

  it('refreshes a stale pull through the complete helpers and answers with both envelopes', async () => {
    const fake = fakeGithub(makeFakePull({ threads: 150, files: 250 }))
    vi.stubGlobal('fetch', fake.fetch)

    const res = await app.fetch(jsonRequest({ numbers: [7], files: 'summary' }), env())

    expect(res.status).toBe(200)
    const [item] = (await res.json()) as PullBatchItem[]
    expect(item!.detail.threads).toHaveLength(150)
    expect(item!.files?.completeness).toEqual({ kind: 'complete' })
    expect(item!.files?.files).toHaveLength(250)
    expect(item!.files?.files[0]).toMatchObject({ position: 0, patchState: 'available', patch: null })
    expect(fake.requests.filter((r) => r.kind === 'graphql-page')).toHaveLength(1)
    expect(fake.requests.filter((r) => r.kind === 'files')).toHaveLength(3)
  })

  it('serves a fresh pull from the mirror without calling GitHub, with full patches when asked', async () => {
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 2 })).fetch)
    await app.fetch(jsonRequest({ numbers: [7] }), env())
    const quiet = vi.fn()
    vi.stubGlobal('fetch', quiet)

    const res = await app.fetch(jsonRequest({ numbers: [7] }), env())

    const [item] = (await res.json()) as PullBatchItem[]
    expect(quiet).not.toHaveBeenCalled()
    expect(item!.files?.files.map((f) => f.patch)).toEqual(['@@ -1 +1 @@\n-old 0\n+new 0', '@@ -1 +1 @@\n-old 1\n+new 1'])
  })

  it('omits files for a pull whose files refresh failed, and leaves out files when none were asked for', async () => {
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 2 }), {
      override: (r) => (r.kind === 'files' ? new Response('unavailable', { status: 500 }) : undefined),
    }).fetch)
    const [failed] = (await (await app.fetch(jsonRequest({ numbers: [7], files: 'summary' }), env())).json()) as PullBatchItem[]
    expect(failed!.files).toBeUndefined()
    expect(failed!.detail.pull?.number).toBe(7)

    const [none] = (await (await app.fetch(jsonRequest({ numbers: [7], files: 'none' }), env())).json()) as PullBatchItem[]
    expect(none!.files).toBeUndefined()
  })

  it('fails the batch on an account-level failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('limited', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })))
    const res = await app.fetch(jsonRequest({ numbers: [7], files: 'summary' }), env())
    expect(res.status).toBe(429)
  })
})
