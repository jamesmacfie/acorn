import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../db'
import { gh } from '../github'
import type { AppEnv } from '../middleware/auth'
import { STALE_AFTER_MS as FILES_STALE_AFTER_MS } from './prMirror'
import { pullFiles } from './pullFiles'
import { repos } from './repos'
import { REPOS_STALE_AFTER_MS, resolveRepoForUser, settleBackground } from './repoMirror'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

vi.mock('../github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../github')>()
  return { ...actual, gh: vi.fn() }
})

const ghRepo = {
  id: 19847,
  name: 'runn',
  private: true,
  default_branch: 'main',
  pushed_at: '2026-06-25T01:00:00Z',
  owner: { login: 'Runn-Fast' },
}

const responseJson = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })

const makeResolverDb = (rows: unknown[] = []) => {
  const inserted: unknown[] = []
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => rows) })) }))
  const insert = vi.fn(() => ({
    values: vi.fn((row: unknown) => ({
      onConflictDoUpdate: vi.fn(async () => {
        inserted.push(row)
      }),
    })),
  }))
  return { db: { select, insert } as never, inserted, insert }
}

const makeReposDb = (rows: unknown[]) => {
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => rows) })) })) }))
  const db = {
    select,
    delete: vi.fn(() => ({ where: vi.fn(() => ({ kind: 'delete' })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ kind: 'insert' })) })),
    batch: vi.fn(async () => []),
  }
  return db as never
}

const makePullFilesDb = (selectRows: unknown[][]) => {
  const queue = [...selectRows]
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => queue.shift() ?? []),
    })),
  }))
  const db = {
    select,
    delete: vi.fn(() => ({ where: vi.fn(() => ({ kind: 'delete' })) })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({ kind: 'upsert' })),
      })),
    })),
    batch: vi.fn(async () => []),
  }
  return db as never
}

describe('resolveRepoForUser', () => {
  it('uses the user-scoped D1 repo row when present', async () => {
    const fetcher = vi.fn()
    const { db, insert } = makeResolverDb([{ id: 123, private: false }])

    const result = await resolveRepoForUser(db, 'token', 'james', 'Runn-Fast', 'runn', fetcher)

    expect(result).toEqual({ ok: true, value: { repoId: 123, private: false } })
    expect(fetcher).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('resolves an accessible cold repo through GitHub and upserts it', async () => {
    const fetcher = vi.fn(async () => responseJson(ghRepo, { headers: { etag: '"repo-etag"' } }))
    const { db, inserted } = makeResolverDb()

    const result = await resolveRepoForUser(db, 'token', 'james', 'Runn-Fast', 'runn', fetcher)

    expect(result).toEqual({ ok: true, value: { repoId: 19847, private: true } })
    expect(fetcher).toHaveBeenCalledWith('token', '/repos/Runn-Fast/runn')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      userId: 'james',
      id: 19847,
      owner: 'Runn-Fast',
      name: 'runn',
      private: true,
      defaultBranch: 'main',
      pushedAt: Date.parse('2026-06-25T01:00:00Z'),
      staleAfter: REPOS_STALE_AFTER_MS,
      etag: '"repo-etag"',
    })
  })

  it('returns repo_not_found for inaccessible cold repos', async () => {
    const fetcher = vi.fn(async () => new Response('not found', { status: 404 }))
    const { db, inserted } = makeResolverDb()

    const result = await resolveRepoForUser(db, 'token', 'james', 'Runn-Fast', 'runn', fetcher)

    expect(result).toEqual({ ok: false, failure: { error: 'repo_not_found', status: 404 } })
    expect(inserted).toHaveLength(0)
  })
})

describe('repos stale-while-revalidate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns stale D1 rows immediately and schedules refresh with waitUntil', async () => {
    const staleRows = [
      {
        userId: 'james',
        id: 19847,
        owner: 'Runn-Fast',
        name: 'runn',
        private: true,
        defaultBranch: 'main',
        pushedAt: Date.parse('2026-06-25T01:00:00Z'),
        fetchedAt: Date.now() - REPOS_STALE_AFTER_MS - 1,
        staleAfter: REPOS_STALE_AFTER_MS,
        etag: null,
      },
    ]
    const db = makeReposDb(staleRows)
    vi.mocked(getDb).mockReturnValue(db)

    let resolveGh!: (res: Response) => void
    const ghPromise = new Promise<Response>((resolve) => {
      resolveGh = resolve
    })
    vi.mocked(gh).mockReturnValue(ghPromise)

    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('user', { token: 'token', login: 'james', name: '', avatar: '', scopes: [] })
      await next()
    })
    app.route('/api/repos', repos)

    const response = await Promise.race([
      app.fetch(new Request('http://acorn.test/api/repos'), {} as Env),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20)),
    ])

    expect(response).toBeInstanceOf(Response)
    expect(response && (await response.json())).toEqual([
      {
        id: 19847,
        owner: 'Runn-Fast',
        name: 'runn',
        private: true,
        defaultBranch: 'main',
        pushedAt: Date.parse('2026-06-25T01:00:00Z'),
      },
    ])
    expect(gh).toHaveBeenCalledWith('token', '/user/repos?sort=pushed&direction=desc&per_page=100')

    resolveGh(responseJson([]))
    await settleBackground()
  })
})

describe('pull files stale-while-revalidate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns stale file summaries immediately and refreshes in waitUntil without reading patch blobs', async () => {
    const fileRow = {
      userId: 'james',
      repoId: 19847,
      number: 12,
      path: 'src/app.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
      sha: 'abc123',
      patch: null,
    }
    const db = makePullFilesDb([
      [{ id: 19847, private: false }],
      [{ userId: 'james', resource: 'files:19847:12', etag: null, fetchedAt: Date.now() - FILES_STALE_AFTER_MS - 1 }],
      [fileRow],
      [],
      [fileRow],
      [],
    ])
    vi.mocked(getDb).mockReturnValue(db)

    let resolveGh!: (res: Response) => void
    const ghPromise = new Promise<Response>((resolve) => {
      resolveGh = resolve
    })
    vi.mocked(gh).mockReturnValue(ghPromise)

    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('user', { token: 'token', login: 'james', name: '', avatar: '', scopes: [] })
      await next()
    })
    app.route('/api/repos', pullFiles)

    const blobGet = vi.fn()

    const response = await Promise.race([
      app.fetch(
        new Request('http://acorn.test/api/repos/Runn-Fast/runn/pulls/12/files?summary=1'),
        { BLOBS: { get: blobGet, put: vi.fn() } } as unknown as Env,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20)),
    ])

    expect(response).toBeInstanceOf(Response)
    expect(response && (await response.json())).toEqual([
      {
        path: 'src/app.ts',
        status: 'modified',
        additions: 3,
        deletions: 1,
        sha: 'abc123',
        viewed: false,
        patch: null,
      },
    ])
    expect(blobGet).not.toHaveBeenCalled()
    expect(gh).toHaveBeenCalledWith('token', '/repos/Runn-Fast/runn/pulls/12/files?per_page=100')

    resolveGh(responseJson([{ filename: 'src/app.ts', status: 'modified', additions: 3, deletions: 1, sha: 'abc123', patch: '@@' }]))
    await settleBackground()
  })

  it('returns stale requested patches in request order and refreshes in waitUntil', async () => {
    const rowA = {
      userId: 'james',
      repoId: 19847,
      number: 12,
      path: 'src/a.ts',
      status: 'modified',
      additions: 2,
      deletions: 0,
      sha: 'sha-a',
      patch: null,
    }
    const rowB = {
      userId: 'james',
      repoId: 19847,
      number: 12,
      path: 'src/b.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      sha: 'sha-b',
      patch: null,
    }
    const db = makePullFilesDb([
      [{ id: 19847, private: false }],
      [{ userId: 'james', resource: 'files:19847:12', etag: null, fetchedAt: Date.now() - FILES_STALE_AFTER_MS - 1 }],
      [rowB, rowA],
      [],
      [rowA, rowB],
      [],
    ])
    vi.mocked(getDb).mockReturnValue(db)

    let resolveGh!: (res: Response) => void
    const ghPromise = new Promise<Response>((resolve) => {
      resolveGh = resolve
    })
    vi.mocked(gh).mockReturnValue(ghPromise)

    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('user', { token: 'token', login: 'james', name: '', avatar: '', scopes: [] })
      await next()
    })
    app.route('/api/repos', pullFiles)

    const blobGet = vi.fn(async (key: string) => (key === 'patch:sha-a' ? '@@ a' : '@@ b'))

    const response = await Promise.race([
      app.fetch(
        new Request('http://acorn.test/api/repos/Runn-Fast/runn/pulls/12/files/patches', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paths: ['src/a.ts', 'src/b.ts'] }),
        }),
        { BLOBS: { get: blobGet, put: vi.fn() } } as unknown as Env,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20)),
    ])

    expect(response).toBeInstanceOf(Response)
    expect(response && (await response.json())).toEqual([
      {
        path: 'src/a.ts',
        status: 'modified',
        additions: 2,
        deletions: 0,
        sha: 'sha-a',
        viewed: false,
        patch: '@@ a',
      },
      {
        path: 'src/b.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        sha: 'sha-b',
        viewed: false,
        patch: '@@ b',
      },
    ])
    expect(blobGet).toHaveBeenCalledTimes(2)
    expect(gh).toHaveBeenCalledWith('token', '/repos/Runn-Fast/runn/pulls/12/files?per_page=100')

    resolveGh(
      responseJson([
        { filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 0, sha: 'sha-a', patch: '@@ a' },
        { filename: 'src/b.ts', status: 'modified', additions: 1, deletions: 1, sha: 'sha-b', patch: '@@ b' },
      ]),
    )
    await settleBackground()
  })
})
