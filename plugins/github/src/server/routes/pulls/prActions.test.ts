import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { AppEnv, Principal } from '@acorn/plugin-api/node'
import { prActions } from './prActions'
// Everything this route test needs from the host, through the one seam a third-party author would use:
// the auth gate, a migrated core database, this plugin's own database, and the `c.env` bindings.
import { makeTestDb, makeTestPluginDb, testEnv, testGate, type TestDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { pullRequests, repos } from '../../../node/schema'
import { gh, ghGraphQL } from '../../githubApi'
import type { GithubEmit } from '../../events'

vi.mock('../../githubApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../githubApi')>()
  return { ...actual, gh: vi.fn(), ghGraphQL: vi.fn() }
})
vi.mock('../../githubToken', () => ({ githubToken: vi.fn(async () => 'token') }))

const PRINCIPAL: Principal = { kind: 'device', userId: 'james', deviceId: 'd1' }

let core: TestDb
let plugin: TestPluginDb
let emit = vi.fn<GithubEmit>()

const req = (principal: Principal | null, method: string, path: string, body?: unknown) => {
  const app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/repos', prActions(plugin.db, emit))
  return app.fetch(
    new Request(`http://acorn.test${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    testEnv({ DB: core.db }),
  )
}

describe('prActions auth + ApiError envelope (no GitHub call paths)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    core = makeTestDb()
    plugin = makeTestPluginDb('github')
    emit = vi.fn<GithubEmit>()
    await plugin.db.insert(repos).values({ userId: 'james', id: 1, owner: 'acme', name: 'widget', fetchedAt: Date.now() })
    await plugin.db.insert(pullRequests).values({
      userId: 'james',
      repoId: 1,
      number: 1,
      nodeId: 'PR_node',
      state: 'open',
      draft: false,
      title: 'Ship it',
      headSha: 'abc123',
      autoMergeEnabled: false,
      fetchedAt: Date.now(),
    })
  })
  afterEach(() => {
    plugin.cleanup()
    core.cleanup()
  })

  it('401s (ApiError) when logged out', async () => {
    const res = await req(null, 'POST', '/api/repos/acme/widget/pulls/1/merge', { method: 'merge' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'unauthenticated' })
  })

  it('repo_not_found (ApiError) when the repo is not mirrored — resolvePr fails before GitHub', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/other/repo/pulls/1/merge', { method: 'merge' })
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'repo_not_found' })
  })

  // Core folds the project facet it hands the client (`runn-fast`), the mirror keeps GitHub's own
  // spelling (`Runn-Fast`), so a case-sensitive match reported every such repo as unmirrored.
  it('resolves a mirrored repo whose owner differs only in case', async () => {
    await plugin.db.insert(repos).values({ userId: 'james', id: 2, owner: 'Acme-Corp', name: 'Widget', fetchedAt: Date.now() })
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme-corp/widget/pulls/1/viewed', { path: 'src/a.ts', viewed: true })
    expect(res.status).toBe(200)
  })

  it('bad_number (ApiError) for a non-integer PR number', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/abc/merge', { method: 'merge' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'bad_number' })
  })

  it('empty_body (ApiError) — resolvePr succeeds, validation rejects before GitHub', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/comments', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'empty_body' })
  })

  it('viewed toggle is app-state only → typed success, no GitHub call', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/viewed', { path: 'src/a.ts', viewed: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ path: 'src/a.ts', viewed: true })
    expect(emit).toHaveBeenCalledWith('pr-synced', {
      repoOwner: 'acme', repoName: 'widget', pullNumber: 1, headSha: 'abc123',
    })
  })

  it('announces every successful PR mirror write or invalidation and suppresses repeat no-ops', async () => {
    const json = (body: unknown = {}) => new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    })
    vi.mocked(gh).mockImplementation(async (_token, path) => {
      if (path.endsWith('/issues/1/comments')) return json({
        node_id: 'comment-1',
        user: { login: 'octocat' },
        body_html: '<p>Hello</p>',
        created_at: '2026-09-11T00:00:00Z',
      })
      if (path.includes('/labels')) return json([{ name: 'ready', color: '00ff00' }])
      if (path.includes('/requested_reviewers')) return json({ requested_reviewers: [{ login: 'reviewer' }] })
      return json()
    })
    vi.mocked(ghGraphQL).mockResolvedValue(json({ data: {} }))

    const expected = {
      repoOwner: 'acme', repoName: 'widget', pullNumber: 1, headSha: 'abc123',
    }
    const succeedsWithEvent = async (method: string, path: string, body?: unknown) => {
      emit.mockClear()
      const response = await req(PRINCIPAL, method, path, body)
      expect(response.status, `${method} ${path}`).toBe(200)
      expect(emit, `${method} ${path}`).toHaveBeenCalledOnce()
      expect(emit).toHaveBeenCalledWith('pr-synced', expected)
    }

    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/merge', { method: 'squash' })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/auto-merge', { method: 'merge' })
    await succeedsWithEvent('DELETE', '/api/repos/acme/widget/pulls/1/auto-merge')
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/close')
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/draft', { draft: true })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/comments', { body: 'Hello' })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/labels', { name: 'ready' })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/viewed', { path: 'src/a.ts', viewed: true })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/review-comments', {
      body: 'Please rename this', path: 'src/a.ts', line: 3, side: 'RIGHT',
    })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/review-comments/42/replies', { body: 'Done' })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/threads/thread-1/resolve', { resolved: true })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/reviews', { event: 'APPROVE' })
    await succeedsWithEvent('POST', '/api/repos/acme/widget/pulls/1/requested-reviewers', { login: 'reviewer' })

    emit.mockClear()
    expect((await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/viewed', {
      path: 'src/a.ts', viewed: true,
    })).status).toBe(200)
    expect(emit).not.toHaveBeenCalled()

    emit.mockClear()
    expect((await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/labels', { name: 'ready' })).status).toBe(200)
    expect(emit).not.toHaveBeenCalled()

    emit.mockClear()
    expect((await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/requested-reviewers', {
      login: 'reviewer',
    })).status).toBe(200)
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not announce a rejected provider write', async () => {
    vi.mocked(gh).mockResolvedValueOnce(new Response('unavailable', { status: 500 }))

    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/merge', { method: 'merge' })

    expect(res.status).toBe(502)
    expect(emit).not.toHaveBeenCalled()
  })
})
