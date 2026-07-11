import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../../../core/server/db'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { GitHubPublicService } from './publicService'

const USER = 'octocat'

describe('GitHubPublicService', () => {
  let t: TestDb
  let blobs: Map<string, string>
  let svc: GitHubPublicService

  beforeEach(async () => {
    t = makeTestDb()
    blobs = new Map([['patch:abc', '@@ -1 +1 @@'], ['filebody:xyz', 'file contents']])
    svc = new GitHubPublicService({
      db: t.db,
      blobs: { get: async (k) => blobs.get(k) ?? null, put: async (k, value) => { blobs.set(k, value) } },
      resolveToken: async () => 'gho_token',
    })
    await t.db.insert(schema.repos).values({ userId: USER, id: 100, owner: 'acme', name: 'web', private: false, defaultBranch: 'main', pushedAt: 2000, fetchedAt: 1 })
    await t.db.insert(schema.pullRequests).values([
      { userId: USER, repoId: 100, number: 5, state: 'open', draft: false, title: 'Open PR', autoMergeEnabled: false, fetchedAt: 1, headRef: 'feat', baseRef: 'main', author: 'octocat', updatedAt: 1500 },
      { userId: USER, repoId: 100, number: 6, state: 'merged', draft: false, title: 'Merged PR', autoMergeEnabled: false, fetchedAt: 1 },
    ])
    await t.db.insert(schema.prFiles).values({ userId: USER, repoId: 100, number: 5, path: 'a.ts', status: 'modified', additions: 3, deletions: 1, sha: 'abc' })
    await t.db.insert(schema.reviews).values({ userId: USER, repoId: 100, number: 5, id: 'rev1', author: 'reviewer', state: 'APPROVED', body: 'lgtm', submittedAt: 1600 })
  })
  afterEach(() => {
    t.cleanup()
    vi.unstubAllGlobals()
  })

  it('projects mirrored repos and pulls', async () => {
    expect(await svc.repos(USER)).toEqual([{ id: 100, owner: 'acme', name: 'web', private: false, defaultBranch: 'main', pushedAt: 2000 }])
    const open = await svc.pulls(USER, 'acme', 'web', 'open')
    expect(open.map((p) => p.number)).toEqual([5])
    const closed = await svc.pulls(USER, 'acme', 'web', 'closed')
    expect(closed.map((p) => p.number)).toEqual([6]) // merged counts as closed
  })

  it('assembles a pull detail from the child mirror tables', async () => {
    const detail = await svc.pullDetail(USER, 'acme', 'web', 5)
    expect(detail.pull?.title).toBe('Open PR')
    expect(detail.reviews).toEqual([{ id: 'rev1', author: 'reviewer', state: 'APPROVED', body: 'lgtm', submittedAt: 1600 }])
  })

  it('lists files with optional patch bodies and reads a blob', async () => {
    const noPatch = await svc.pullFiles(USER, 'acme', 'web', 5, false)
    expect(noPatch[0]).toMatchObject({ path: 'a.ts', patch: null, additions: 3 })
    const withPatch = await svc.pullFiles(USER, 'acme', 'web', 5, true)
    expect(withPatch[0].patch).toBe('@@ -1 +1 @@')
    expect(await svc.blob('xyz')).toEqual({ text: 'file contents' })
  })

  it('creates a PR via the resolved credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ number: 42 }), { status: 201, headers: { 'content-type': 'application/json' } })))
    expect(await svc.createPull(USER, 'acme', 'web', { title: 'x', body: '', base: 'main', head: 'feat', draft: false })).toEqual({ number: 42 })
  })

  it('maps an upstream 401 to 424 upstream_reauthentication_required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad creds', { status: 401 })))
    await expect(svc.merge(USER, 'acme', 'web', 5, 'squash')).rejects.toMatchObject({ code: 'upstream_reauthentication_required', status: 424 })
  })

  it('424s a mutation when no GitHub credential is stored', async () => {
    const noCred = new GitHubPublicService({
      db: t.db,
      blobs: { get: async () => null, put: async () => undefined },
      resolveToken: async () => null,
    })
    await expect(noCred.comment(USER, 'acme', 'web', 5, 'hi')).rejects.toMatchObject({ code: 'upstream_reauthentication_required' })
    await expect(noCred.refreshPulls(USER, 'acme', 'web')).rejects.toMatchObject({ code: 'upstream_reauthentication_required' })
  })

  it('does not report repository refresh success when GitHub rejects the credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad creds', { status: 401 })))
    await expect(svc.refreshRepos(USER)).rejects.toMatchObject({ code: 'upstream_reauthentication_required', status: 424 })
  })

  it('toggles local "viewed" state without an upstream call', async () => {
    await svc.setViewed(USER, 'acme', 'web', 5, 'a.ts', true)
    let files = await svc.pullFiles(USER, 'acme', 'web', 5, false)
    expect(files[0].viewed).toBe(true)
    await svc.setViewed(USER, 'acme', 'web', 5, 'a.ts', false)
    files = await svc.pullFiles(USER, 'acme', 'web', 5, false)
    expect(files[0].viewed).toBe(false)
  })

  it('adds a label and returns the complete set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ name: 'bug', color: 'red' }]), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await svc.labels(USER, 'acme', 'web', 5, 'add', 'bug')).toEqual([{ name: 'bug', color: 'red' }])
  })

  it('sets draft via a GraphQL mutation', async () => {
    // pullRequests row 5 has no nodeId; give one via a direct update so prMeta resolves.
    const { schema: s } = await import('../../../core/server/db')
    const { and, eq } = await import('drizzle-orm')
    await t.db.update(s.pullRequests).set({ nodeId: 'PR_node' }).where(and(eq(s.pullRequests.userId, USER), eq(s.pullRequests.repoId, 100), eq(s.pullRequests.number, 5)))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { convertPullRequestToDraft: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await svc.setDraft(USER, 'acme', 'web', 5, true)).toEqual({ draft: true })
  })
})
