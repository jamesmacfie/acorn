import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { patchBlobKey } from '@acorn/node-core/server/blobs.ts'
import { filesResource, prResource, pullsResource } from '../resourceKeys'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/server/routes/testDb.ts'
import { migrationsDir } from '../../node/migrations'
import { createTaskService } from '@acorn/node-core/main/core/tasks.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { GqlPull } from './prMirror'
import { refreshOpenPulls, refreshPullWithFiles } from './pullRefresh'
import { checks, comments, prFiles, pullRequests, syncState } from '../../node/schema'

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

// TWO handles, because this operation now spans two SQLite files and cannot pretend otherwise. The PR
// mirror is github's own (`plugin.db`); `tasks` is CORE's, reached through CoreServices.tasks. The mirror
// replace is still one all-or-nothing `db.batch` within github's file — what changed is that the task
// adoption is no longer inside it, so it is asserted as an effect that follows the batch rather than as
// part of it.
describe('shared pull refresh operations', () => {
  let core: TestDb
  let plugin: TestPluginDb
  let tasks: ReturnType<typeof createTaskService>
  let blobs: Map<string, string>

  beforeEach(() => {
    core = makeTestDb()
    plugin = makeTestPluginDb('github', migrationsDir())
    tasks = createTaskService(core.db)
    blobs = new Map()
  })
  afterEach(() => {
    plugin.cleanup()
    core.cleanup()
    vi.unstubAllGlobals()
  })

  it('atomically replaces open pulls, then backfills a matching local task through CoreServices.tasks', async () => {
    await plugin.db.insert(pullRequests).values({
      userId: USER,
      repoId: REPO_ID,
      number: 4,
      state: 'open',
      draft: false,
      title: 'Old',
      fetchedAt: 1,
    })
    await plugin.db.insert(prFiles).values({
      userId: USER,
      repoId: REPO_ID,
      number: 4,
      path: 'private.ts',
      sha: 'old',
    })
    await plugin.db.insert(comments).values({
      userId: USER,
      repoId: REPO_ID,
      number: 4,
      id: 'comment-4',
      body: 'sensitive review comment',
    })
    await plugin.db.insert(checks).values({
      userId: USER,
      repoId: REPO_ID,
      number: 4,
      name: 'private-check',
      status: 'failure',
    })
    await core.db.insert(schema.tasks).values({
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

    expect(await refreshOpenPulls('token', plugin.db, { tasks }, key, fetcher)).toEqual({ ok: true })
    const pulls = await plugin.db.select().from(pullRequests).where(eq(pullRequests.repoId, REPO_ID))
    expect(pulls.map((pull) => pull.number)).toEqual([5])
    expect(await plugin.db.select().from(prFiles)).toEqual([])
    expect(await plugin.db.select().from(comments)).toEqual([])
    expect(await plugin.db.select().from(checks)).toEqual([])
    // Flow B, in core's file now. Same observable outcome as when this write rode in the mirror's batch;
    // what it no longer proves is that the two were one transaction, because two SQLite files cannot share
    // one — see the ordering test below for the guarantee that replaced it.
    expect((await core.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-1')))[0].pullNumber).toBe(5)
    expect((await plugin.db.select().from(syncState).where(eq(syncState.resource, pullsResource(REPO_ID, 'open'))))[0].etag).toBe('"open-v2"')
  })

  // The guarantee that took over from "it was all one transaction": the adoption runs only AFTER the
  // mirror batch commits, so a refresh that never reaches the batch cannot adopt a PR into a task. Without
  // this, moving the write out of the batch could regress into adopting on a failed refresh unnoticed.
  it('does not adopt a PR into a task when the open-PR fetch fails', async () => {
    await core.db.insert(schema.tasks).values({
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
    const adoptPullNumbers = vi.spyOn(tasks, 'adoptPullNumbers')
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 500 }))

    const result = await refreshOpenPulls('token', plugin.db, { tasks }, key, fetcher)

    expect(result.ok).toBe(false)
    expect(adoptPullNumbers).not.toHaveBeenCalled()
    expect((await core.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-1')))[0].pullNumber).toBeNull()
    expect(await plugin.db.select().from(pullRequests)).toEqual([])
  })

  // Idempotence is what makes "after the batch" safe: a crash between the mirror commit and the adoption
  // self-heals on the next refresh, and re-running never steals a PR number from a task that already has
  // one or from a branch nobody is on.
  it('re-adopting is idempotent and never overwrites a task that already has a PR', async () => {
    await core.db.insert(schema.tasks).values([
      { id: 'task-adopt', title: 'Adopt me', origin: 'local', repoOwner: 'acme', repoName: 'web', branch: 'feature', status: 'active', createdAt: 1, updatedAt: 1 },
      { id: 'task-taken', title: 'Already has one', origin: 'local', repoOwner: 'acme', repoName: 'web', branch: 'feature', pullNumber: 99, status: 'active', createdAt: 1, updatedAt: 1 },
      { id: 'task-other', title: 'Different branch', origin: 'local', repoOwner: 'acme', repoName: 'web', branch: 'other', status: 'active', createdAt: 1, updatedAt: 1 },
    ])
    const fetcher = vi.fn(async () =>
      json(
        [{ number: 5, node_id: 'PR_5', state: 'open', draft: false, title: 'Fresh', head: { ref: 'feature' }, base: { ref: 'main' }, user: { login: USER }, updated_at: '2026-07-11T00:00:00Z' }],
        { headers: { etag: '"open-v2"' } },
      ),
    )

    expect(await refreshOpenPulls('token', plugin.db, { tasks }, key, fetcher)).toEqual({ ok: true })
    expect(await refreshOpenPulls('token', plugin.db, { tasks }, key, fetcher)).toEqual({ ok: true })

    const byId = new Map((await core.db.select().from(schema.tasks)).map((task) => [task.id, task.pullNumber]))
    expect(byId.get('task-adopt')).toBe(5)
    expect(byId.get('task-taken')).toBe(99)
    expect(byId.get('task-other')).toBeNull()
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

    expect(await refreshPullWithFiles('token', plugin.db, store, { ...key, number: 5 })).toEqual({ ok: true })
    expect((await plugin.db.select().from(pullRequests))[0]).toMatchObject({ number: 5, title: 'Fresh title', headRef: 'feature' })
    expect((await plugin.db.select().from(prFiles))[0]).toMatchObject({ path: 'src/app.ts', sha: 'file-sha' })
    expect(blobs.get(patchBlobKey('file-sha'))).toBe('@@ patch')
    const resources = (await plugin.db.select().from(syncState)).map((row) => row.resource)
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
      plugin.db,
      { get: async () => null, put: async () => undefined },
      { ...key, number: 5 },
    )
    expect(result).toEqual({ ok: false, failure: { error: 'github_unavailable', status: 502 } })
    expect(await plugin.db.select().from(pullRequests)).toEqual([])
    expect(await plugin.db.select().from(prFiles)).toEqual([])
  })

  it('returns not found when GitHub has no such pull request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/graphql')) return json({ data: { repository: { pullRequest: null } } })
      return json([])
    }))
    const result = await refreshPullWithFiles(
      'token',
      plugin.db,
      { get: async () => null, put: async () => undefined },
      { ...key, number: 404 },
    )
    expect(result).toEqual({ ok: false, failure: { error: 'pull_not_found', status: 404 } })
  })
})
