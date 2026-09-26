import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Env } from '@acorn/plugin-api/testkit'
import type { PullFile, PullFilesResponse } from '../../../shared/api'
import { fakeGithub, makeFakePull } from '../mirror/fakeGithub.helper'
import { pullFiles } from './pullFiles'
import { resolveRepoForUser } from '../mirror/repoMirror'

vi.mock('../mirror/repoMirror', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mirror/repoMirror')>()
  return { ...actual, resolveRepoForUser: vi.fn() }
})
vi.mock('../../githubToken', () => ({ githubToken: async () => 'token' }))

let plugin: TestPluginDb
let blobs: Map<string, string>
let app: Hono<AppEnv>
const env = () => ({
  BLOBS: { get: async (k: string) => blobs.get(k) ?? null, put: async (k: string, v: string) => void blobs.set(k, v) },
}) as unknown as Env
const get = async (query = '') => app.fetch(new Request(`http://acorn.test/api/repos/acme/web/pulls/7/files${query}`), env())
const patches = async (paths: string[]) => app.fetch(new Request('http://acorn.test/api/repos/acme/web/pulls/7/files/patches', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ paths }),
}), env())

// File 1 is binary: GitHub sends no patch for it.
const pull = () => makeFakePull({ files: 120, patch: (i) => (i === 1 ? undefined : `@@ -1 +1 @@\n+file ${i}`) })

describe('pull files route', () => {
  beforeEach(() => {
    plugin = makeTestPluginDb('github')
    blobs = new Map()
    app = new Hono<AppEnv>().use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    }).route('/api/repos', pullFiles(plugin.db))
    vi.mocked(resolveRepoForUser).mockResolvedValue({ ok: true, value: { repoId: 19847 } })
  })
  afterEach(() => {
    plugin.cleanup()
    vi.unstubAllGlobals()
  })

  it('answers summaries as an envelope, in provider order, with patch state but no bodies', async () => {
    vi.stubGlobal('fetch', fakeGithub(pull()).fetch)
    const body = (await (await get('?summary=1')).json()) as PullFilesResponse
    expect(body.completeness).toEqual({ kind: 'complete' })
    expect(body.files).toHaveLength(120)
    expect(body.files.map((f) => f.position)).toEqual(Array.from({ length: 120 }, (_, i) => i))
    expect(body.files[0]).toMatchObject({ patchState: 'available', patch: null })
    expect(body.files[1]).toMatchObject({ patchState: 'unavailable', patchKey: null, patch: null })
  })

  it('answers the patches lookup in request order, leaving out unknown paths and keeping unavailable ones', async () => {
    vi.stubGlobal('fetch', fakeGithub(pull()).fetch)
    const body = (await (await patches(['src/file-5.ts', 'nope.ts', 'src/file-1.ts', 'src/file-0.ts'])).json()) as PullFile[]
    expect(body.map((f) => f.path)).toEqual(['src/file-5.ts', 'src/file-1.ts', 'src/file-0.ts'])
    expect(body.map((f) => f.patch)).toEqual(['@@ -1 +1 @@\n+file 5', null, '@@ -1 +1 @@\n+file 0'])
    expect(body[1]!.patchState).toBe('unavailable')
  })

  it('reads one path through the same envelope', async () => {
    vi.stubGlobal('fetch', fakeGithub(pull()).fetch)
    const body = (await (await get('?path=src%2Ffile-3.ts')).json()) as PullFilesResponse
    expect(body.files.map((f) => f.patch)).toEqual(['@@ -1 +1 @@\n+file 3'])
  })

  it('repairs a missing patch body with a refresh instead of serving it as no diff', async () => {
    const fake = fakeGithub(pull())
    vi.stubGlobal('fetch', fake.fetch)
    await get('?summary=1')
    const before = fake.requests.length
    blobs.clear()

    const body = (await (await patches(['src/file-0.ts'])).json()) as PullFile[]

    expect(body[0]!.patch).toBe('@@ -1 +1 @@\n+file 0')
    expect(fake.requests.length).toBeGreaterThan(before)
  })

  it('force-refreshes past a fresh mirror and reports a capped list', async () => {
    vi.stubGlobal('fetch', fakeGithub(pull()).fetch)
    await get('?summary=1')
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 3100, changedFiles: 3100 })).fetch)

    const cached = (await (await get('?summary=1')).json()) as PullFilesResponse
    expect(cached.files).toHaveLength(120)
    const forced = (await (await get('?force=true')).json()) as PullFilesResponse
    expect(forced.files).toHaveLength(3000)
    expect(forced.completeness).toEqual({ kind: 'incomplete', cause: 'upstream-cap', resource: 'files', received: 3000, reportedTotal: 3100, limit: 3000 })
  })
})
