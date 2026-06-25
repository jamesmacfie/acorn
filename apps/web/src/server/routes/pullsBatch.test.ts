import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { readComposite, readFiles, STALE_AFTER_MS } from './prMirror'
import { pullsBatch } from './pullsBatch'
import { resolveRepoForUser } from './repoMirror'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

vi.mock('../github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../github')>()
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

const app = new Hono<AppEnv>()
app.use('/api/*', async (c, next) => {
  c.set('user', { token: 'token', login: 'james', name: '', avatar: '', scopes: [] })
  await next()
})
app.route('/api/repos', pullsBatch)

const jsonRequest = (body: unknown) =>
  new Request('http://acorn.test/api/repos/acorn/web/pulls/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const makeDb = () => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => [
        { resource: 'pr:19847:42', fetchedAt: Date.now() - STALE_AFTER_MS + 1000 },
        { resource: 'files:19847:42', fetchedAt: Date.now() - STALE_AFTER_MS + 1000 },
      ]),
    })),
  })),
})

describe('pulls batch route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDb).mockReturnValue(makeDb() as never)
    vi.mocked(resolveRepoForUser).mockResolvedValue({ ok: true, value: { repoId: 19847, private: false } })
    vi.mocked(readComposite).mockResolvedValue({
      pull: null,
      labels: [],
      reviews: [],
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
    const res = await app.fetch(jsonRequest({ numbers: [42], files: 'summary' }), {} as Env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        number: 42,
        detail: { pull: null, labels: [], reviews: [], comments: [], commits: [], checks: [], threads: [] },
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
    expect(readFiles).toHaveBeenCalledWith(expect.anything(), expect.anything(), { userId: 'james', repoId: 19847, number: 42 }, { includePatches: false })
  })

  it('keeps full file payloads as the backward-compatible default', async () => {
    const res = await app.fetch(jsonRequest({ numbers: [42] }), {} as Env)

    expect(res.status).toBe(200)
    expect(readFiles).toHaveBeenCalledWith(expect.anything(), expect.anything(), { userId: 'james', repoId: 19847, number: 42 }, { includePatches: true })
  })
})
