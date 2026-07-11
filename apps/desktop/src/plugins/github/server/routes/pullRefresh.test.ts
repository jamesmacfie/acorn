import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { patchBlobKey } from '../../../../core/server/blobs'
import { schema } from '../../../../core/server/db'
import { filesResource, prResource, pullsResource } from '../../../../core/server/db/resourceKeys'
import { makeTestDb, type TestDb } from '../../../../core/server/routes/testDb'
import type { GqlPull } from './prMirror'
import { refreshOpenPulls, refreshPullWithFiles } from './pullRefresh'

const USER = 'octocat'
const REPO_ID = 100
const key = { userId: USER, repoId: REPO_ID, owner: 'acme', repo: 'web' }

const gqlPull: GqlPull = {
  id: 'PR_5',
  number: 5,
  title: 'Fresh title',
  state: 'OPEN',
  isDraft: false,
  bodyHTML: '<p>Body</p>',
  headRefOid: 'abc123',
  author: { login: USER },
  baseRefName: 'main',
  headRefName: 'feature',
  updatedAt: '2026-07-11T00:00:00Z',
  labels: { nodes: [{ name: 'bug', color: 'ff0000' }] },
  reviews: { nodes: [] },
  reviewRequests: { nodes: [] },
  comments: { nodes: [] },
  commitTimeline: { nodes: [] },
  reviewThreads: { nodes: [] },
  latestCommit: { nodes: [] },
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  autoMergeRequest: null,
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })

describe('shared pull refresh operations', () => {
  let t: TestDb
  let blobs: Map<string, string>

  beforeEach(() => {
    t = makeTestDb()
    blobs = new Map()
  })
  afterEach(() => {
    t.cleanup()
    vi.unstubAllGlobals()
  })

  it('atomically replaces open pulls and backfills a matching local task', async () => {
    await t.db.insert(schema.pullRequests).values({
      userId: USER,
      repoId: REPO_ID,
      number: 4,
      state: 'open',
      draft: false,
      title: 'Old',
      fetchedAt: 1,
    })
    await t.db.insert(schema.tasks).values({
      id: 'task-1',
      title: 'Feature',
      origin: 'local',
      repoOwner: 'acme',
      repoName: 'web',
      branch: 'feature',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })
    const fetcher = vi.fn(async () =>
      json(
        [{ number: 5, node_id: 'PR_5', state: 'open', draft: false, title: 'Fresh', head: { ref: 'feature' }, base: { ref: 'main' }, user: { login: USER }, updated_at: '2026-07-11T00:00:00Z' }],
        { headers: { etag: '"open-v2"' } },
      ),
    )

    expect(await refreshOpenPulls('token', t.db, key, fetcher)).toEqual({ ok: true })
    const pulls = await t.db.select().from(schema.pullRequests).where(eq(schema.pullRequests.repoId, REPO_ID))
    expect(pulls.map((pull) => pull.number)).toEqual([5])
    expect((await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-1')))[0].pullNumber).toBe(5)
    expect((await t.db.select().from(schema.syncState).where(eq(schema.syncState.resource, pullsResource(REPO_ID, 'open'))))[0].etag).toBe('"open-v2"')
  })

  it('refreshes one PR composite and changed files, including patch blobs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/graphql')) return json({ data: { repository: { pullRequest: gqlPull } } })
      if (url.includes('/pulls/5/files')) {
        return json([{ filename: 'src/app.ts', status: 'modified', additions: 2, deletions: 1, sha: 'file-sha', patch: '@@ patch' }])
      }
      throw new Error(`Unexpected URL ${url}`)
    }))
    const store = {
      get: async (blobKey: string) => blobs.get(blobKey) ?? null,
      put: async (blobKey: string, value: string) => { blobs.set(blobKey, value) },
    }

    expect(await refreshPullWithFiles('token', t.db, store, { ...key, number: 5 })).toEqual({ ok: true })
    expect((await t.db.select().from(schema.pullRequests))[0]).toMatchObject({ number: 5, title: 'Fresh title', headRef: 'feature' })
    expect((await t.db.select().from(schema.prFiles))[0]).toMatchObject({ path: 'src/app.ts', sha: 'file-sha' })
    expect(blobs.get(patchBlobKey('file-sha'))).toBe('@@ patch')
    const resources = (await t.db.select().from(schema.syncState)).map((row) => row.resource)
    expect(resources).toEqual(expect.arrayContaining([prResource(REPO_ID, 5), filesResource(REPO_ID, 5)]))
  })

  it('does not write either mirror when the files fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/graphql')) return json({ data: { repository: { pullRequest: gqlPull } } })
      return new Response('unavailable', { status: 500 })
    }))
    const result = await refreshPullWithFiles(
      'token',
      t.db,
      { get: async () => null, put: async () => undefined },
      { ...key, number: 5 },
    )
    expect(result).toEqual({ ok: false, failure: { error: 'github_unavailable', status: 502 } })
    expect(await t.db.select().from(schema.pullRequests)).toEqual([])
    expect(await t.db.select().from(schema.prFiles)).toEqual([])
  })

  it('returns not found when GitHub has no such pull request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/graphql')) return json({ data: { repository: { pullRequest: null } } })
      return json([])
    }))
    const result = await refreshPullWithFiles(
      'token',
      t.db,
      { get: async () => null, put: async () => undefined },
      { ...key, number: 404 },
    )
    expect(result).toEqual({ ok: false, failure: { error: 'pull_not_found', status: 404 } })
  })
})
