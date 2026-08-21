import { testSecretEnv } from '@acorn/node-core/testkit/db.ts'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { PULLS_STALE_AFTER_MS as STALE_AFTER_MS } from '../syncPolicy'
import { readComposite, readFiles } from './prMirror'
import { pullsBatch } from './pullsBatch'
import { resolveRepoForUser } from './repoMirror'
import type { Env } from '@acorn/node-core/main/bindings.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

vi.mock('..', async (importOriginal) => {
  const actual = await importOriginal<typeof import('..')>()
  return { ...actual, ghError: vi.fn(() => null), ghGraphQL: vi.fn() }
})

vi.mock('./repoMirror', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./repoMirror')>()
  return { ...actual, resolveRepoForUser: vi.fn() }
})

vi.mock('./prMirror', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./prMirror')>()
  return {
    ...actual,
    fetchFiles: vi.fn(),
    mirrorFiles: vi.fn(),
    mirrorPr: vi.fn(),
    readComposite: vi.fn(),
    readFiles: vi.fn(),
  }
})

const jsonRequest = (body: unknown) =>
  new Request('http://acorn.test/api/repos/acorn/web/pulls/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// The plugin handle the router is a factory over. It answers exactly one query, the per-PR
// `sync_state` freshness read, because every mirror read/write around it is mocked above; both
// resources come back fresh so nothing reaches GitHub. It is handed to the factory directly now
// instead of through a getDb mock, which is why that mock is gone.
const makeDb = () =>
  ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [
          { resource: 'pr:19847:42', fetchedAt: Date.now() - STALE_AFTER_MS + 1000 },
          { resource: 'files:19847:42', fetchedAt: Date.now() - STALE_AFTER_MS + 1000 },
        ]),
      })),
    })),
  }) as unknown as PluginDatabase

// Core's handle, on `env.DB`: the stored GitHub credential lives in core's `integrations` table and
// is read through the core seam. No rows is the not-connected path, and the token is never spent
// here because the batch is fully fresh.
const noIntegrations = { select: () => ({ from: () => ({ where: async () => [] }) }) } as unknown as Env['DB']

// `BLOBS` is here because the route hands `readFiles` a blob store rather than the whole binding set:
// `readFiles(env: Env, …)` named SECRETS/ACTIVE_IDENTITY/INTERNAL_TOKEN to reach two methods, so it now
// takes the two methods (prMirror.ts § PatchBlobStore). A fixture that omitted them passed only because
// `Env` was an object and `expect.anything()` does not look inside one.
const blobs = { get: vi.fn(async () => null), put: vi.fn(async () => undefined) }
const env = () => ({ DB: noIntegrations, BLOBS: blobs, ...testSecretEnv('0'.repeat(64)) }) as unknown as Env

let app: Hono<AppEnv>

describe('pulls batch route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    app.route('/api/repos', pullsBatch(makeDb()))
    vi.mocked(resolveRepoForUser).mockResolvedValue({ ok: true, value: { repoId: 19847 } })
    vi.mocked(readComposite).mockResolvedValue({
      pull: null,
      labels: [],
      reviews: [],
      requestedReviewers: [],
      comments: [],
      commits: [],
      checks: [],
      threads: [],
    })
    vi.mocked(readFiles).mockResolvedValue([
      {
        path: 'src/app.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        sha: 'sha-app',
        viewed: false,
        patch: null,
      },
    ])
  })

  it('returns summary-mode file rows without reading patch bodies', async () => {
    const res = await app.fetch(jsonRequest({ numbers: [42], files: 'summary' }), env())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        number: 42,
        detail: { pull: null, labels: [], reviews: [], requestedReviewers: [], comments: [], commits: [], checks: [], threads: [] },
        files: [
          {
            path: 'src/app.ts',
            status: 'modified',
            additions: 1,
            deletions: 0,
            sha: 'sha-app',
            viewed: false,
            patch: null,
          },
        ],
      },
    ])
    expect(readFiles).toHaveBeenCalledWith(blobs, expect.anything(), { userId: 'james', repoId: 19847, number: 42 }, { includePatches: false })
  })

  it('keeps full file payloads as the backward-compatible default', async () => {
    const res = await app.fetch(jsonRequest({ numbers: [42] }), env())

    expect(res.status).toBe(200)
    expect(readFiles).toHaveBeenCalledWith(blobs, expect.anything(), { userId: 'james', repoId: 19847, number: 42 }, { includePatches: true })
  })
})
