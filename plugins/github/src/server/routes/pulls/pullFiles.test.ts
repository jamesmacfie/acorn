import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Env } from '@acorn/plugin-api/testkit'
import type { DiffSearchPage, DiffSegmentPayload } from '@acorn/plugin-api/ui/diff'
import type { PullDiffResponse, PullFilesResponse } from '../../../shared/api'
import { diffDocument } from './diffDocument'
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
const diff = async (query = '') => app.fetch(new Request(`http://acorn.test/api/repos/acme/web/pulls/7/diff${query}`), env())
const post = async (path: string, body: unknown) => app.fetch(new Request(`http://acorn.test/api/repos/acme/web/${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
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
    }).route('/api/repos', pullFiles(plugin.db)).route('/api/repos', diffDocument(plugin.db))
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

  it('answers the diff as a document in provider order, with descriptors and no patch text', async () => {
    vi.stubGlobal('fetch', fakeGithub(pull()).fetch)
    const body = (await (await diff()).json()) as PullDiffResponse
    expect(body.completeness).toEqual({ kind: 'complete' })
    expect(body.document.files.map((file) => file.path)).toEqual(Array.from({ length: 120 }, (_, i) => `src/file-${i}.ts`))
    expect(body.document.files[0]).toMatchObject({ patchKey: expect.stringMatching(/^sha256:/), segments: [{ rows: 3, bands: 3 }] })
    // GitHub sent no patch for file 1: no key and no segments, which the viewer draws as no diff.
    expect(body.document.files[1]).toMatchObject({ patchKey: null, segments: [] })
    expect(body.document.totals).toMatchObject({ files: 120, segments: 119 })
    expect(JSON.stringify(body)).not.toContain('+file')
  })

  it('serves segments and search pages by patch digest from the same mirror', async () => {
    vi.stubGlobal('fetch', fakeGithub(pull()).fetch)
    const { document } = (await (await diff()).json()) as PullDiffResponse
    const file = document.files[5]!
    const segments = (await (await post('diff/segments', { requests: [{ path: file.path, patchKey: file.patchKey, ordinal: 0 }] })).json()) as DiffSegmentPayload[]
    expect(segments[0]!.rows).toEqual([
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'insert', oldNo: null, newNo: 1, raw: 'file 5' },
      { kind: 'gap', side: 'bottom', oldStart: 2, newStart: 2, count: null },
    ])
    const files = document.files.flatMap((entry) => (entry.patchKey ? [{ path: entry.path, patchKey: entry.patchKey }] : []))
    const page = (await (await post('diff/search', { query: 'FILE 11', caseSensitive: false, cursor: null, files })).json()) as DiffSearchPage
    expect(page.matches.map((match) => [match.path, match.ordinal, match.row])).toEqual([
      ['src/file-11.ts', 0, 1], ['src/file-110.ts', 0, 1], ['src/file-111.ts', 0, 1], ['src/file-112.ts', 0, 1],
      ['src/file-113.ts', 0, 1], ['src/file-114.ts', 0, 1], ['src/file-115.ts', 0, 1], ['src/file-116.ts', 0, 1],
      ['src/file-117.ts', 0, 1], ['src/file-118.ts', 0, 1], ['src/file-119.ts', 0, 1],
    ])
  })

  it('refuses segment requests it cannot answer exactly, with bounded errors', async () => {
    vi.stubGlobal('fetch', fakeGithub(pull()).fetch)
    const { document } = (await (await diff()).json()) as PullDiffResponse
    const file = document.files[0]!
    // A digest this plugin could not have written never becomes a blob key.
    expect((await post('diff/segments', { requests: [{ path: file.path, patchKey: 'patch:../../etc', ordinal: 0 }] })).status).toBe(400)
    // A patch the node does not hold, and an ordinal the patch does not have.
    expect((await post('diff/segments', { requests: [{ path: file.path, patchKey: `sha256:${'0'.repeat(64)}`, ordinal: 0 }] })).status).toBe(404)
    expect((await post('diff/segments', { requests: [{ path: file.path, patchKey: file.patchKey, ordinal: 9 }] })).status).toBe(400)
    // Too many at once, and none.
    const many = Array.from({ length: 33 }, () => ({ path: file.path, patchKey: file.patchKey, ordinal: 0 }))
    expect((await post('diff/segments', { requests: many })).status).toBe(400)
    expect((await post('diff/segments', { requests: [] })).status).toBe(400)
    expect((await post('diff/search', { query: 'x', caseSensitive: false, cursor: 'forged', files: [] })).status).toBe(400)
  })

  it('reads one path through the same envelope', async () => {
    vi.stubGlobal('fetch', fakeGithub(pull()).fetch)
    const body = (await (await get('?path=src%2Ffile-3.ts')).json()) as PullFilesResponse
    expect(body.files.map((f) => f.patch)).toEqual(['@@ -1 +1 @@\n+file 3'])
  })

  it('repairs a missing patch body with a refresh instead of serving it as no diff', async () => {
    // Patches no other test has parsed, so the node's parse cache cannot answer for the missing bodies.
    const fake = fakeGithub(makeFakePull({ files: 3, patch: (i) => `@@ -1 +1 @@\n+repair ${i}` }))
    vi.stubGlobal('fetch', fake.fetch)
    await get('?summary=1')
    const before = fake.requests.length
    blobs.clear()

    const body = (await (await diff()).json()) as PullDiffResponse

    expect(body.document.files[0]!.segments).toHaveLength(1)
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
