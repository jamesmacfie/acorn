import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pullsResource } from '../../resourceKeys'
import { makeTestDb, makeTestPluginDb, schema, type TestDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { createTaskService } from '@acorn/plugin-api/testkit'
import { mirrorPr } from '../mirror/prMirror'
import type { PullComposite } from '../mirror/prFetch'
import { announcePrSynced, refreshOpenPulls } from './pullRefresh'
import { checks, comments, prFiles, pullRequests, syncState } from '../../../node/schema'

const USER = 'octocat'
const REPO_ID = 100
const key = { userId: USER, repoId: REPO_ID, owner: 'acme', repo: 'web' }

const scalars = {
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
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  autoMergeRequest: null,
}
// The composite as prFetch hands it to the mirror, and the first GraphQL page it was fetched from.
const composite: PullComposite = {
  ...scalars,
  labels: [{ name: 'bug', color: 'ff0000' }],
  reviews: [],
  reviewRequests: [],
  comments: [],
  commits: [],
  threads: [],
  checks: [],
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })

// Two handles, because this operation spans two SQLite files. The PR mirror is github's own
// (`plugin.db`); `tasks` is core's, reached through CoreServices.tasks. The mirror replace is one
// all-or-nothing `db.batch` within github's file, and the task adoption sits outside it, so the
// tests assert adoption as an effect that follows the batch.
describe('shared pull refresh operations', () => {
  let core: TestDb
  let plugin: TestPluginDb
  let tasks: ReturnType<typeof createTaskService>

  beforeEach(async () => {
    core = makeTestDb()
    plugin = makeTestPluginDb('github')
    tasks = createTaskService(core.db)
    const now = Date.now()
    await core.db
      .insert(schema.workspaces)
      .values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await core.db.insert(schema.projects).values({
      id: 'project-web',
      name: 'web',
      path: null,
      workspaceId: 'workspace-1',
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: 'https://github.com/acme/web.git',
      githubOwner: 'acme',
      githubName: 'web',
      repoProvider: 'github',
      repoHost: 'github.com',
      repoPath: 'acme/web',
      githubRepoId: REPO_ID,
      createdAt: now,
      updatedAt: now,
    })
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
      position: 0,
      patchState: 'unavailable',
    })
    await plugin.db.insert(comments).values({
      userId: USER,
      repoId: REPO_ID,
      number: 4,
      id: 'comment-4',
      body: 'sensitive review comment',
      position: 0,
    })
    await plugin.db.insert(checks).values({
      userId: USER,
      repoId: REPO_ID,
      number: 4,
      name: 'private-check',
      status: 'failure',
      position: 0,
    })
    await core.db.insert(schema.tasks).values({
      id: 'task-1',
      title: 'Feature',
      origin: 'local',
      projectId: 'project-web',
      branch: 'feature',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })
    const fetcher = vi.fn(async () =>
      json(
        [
          {
            number: 5,
            node_id: 'PR_5',
            state: 'open',
            draft: false,
            title: 'Fresh',
            head: { ref: 'feature' },
            base: { ref: 'main' },
            user: { login: USER },
            updated_at: '2026-07-11T00:00:00Z',
          },
        ],
        { headers: { etag: '"open-v2"' } },
      ),
    )

    expect(await refreshOpenPulls('token', plugin.db, { tasks }, key, fetcher)).toEqual({ ok: true })
    const pulls = await plugin.db.select().from(pullRequests).where(eq(pullRequests.repoId, REPO_ID))
    expect(pulls.map((pull) => pull.number)).toEqual([5])
    expect(await plugin.db.select().from(prFiles)).toEqual([])
    expect(await plugin.db.select().from(comments)).toEqual([])
    expect(await plugin.db.select().from(checks)).toEqual([])
    // The adoption, in core's file. This proves the outcome, not that the two writes share a transaction:
    // two SQLite files cannot. The ordering test below covers the guarantee that stands in for one.
    expect((await core.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-1')))[0].pullNumber).toBe(5)
    expect(
      (
        await plugin.db
          .select()
          .from(syncState)
          .where(eq(syncState.resource, pullsResource(REPO_ID, 'open')))
      )[0].etag,
    ).toBe('"open-v2"')
  })

  // `checks-changed` is the verb a consumer alerts on, so it must track the checks rows and not the
  // sync itself: a re-mirror that changes nothing announces `pr-synced` alone.
  it('reports a checks change only when the mirrored check rows differ', async () => {
    const withCheck = (status: string): PullComposite => ({
      ...composite,
      checks: [
        {
          __typename: 'CheckRun',
          id: 'check-ci',
          name: 'ci',
          status: 'COMPLETED',
          conclusion: status,
          detailsUrl: null,
          checkSuite: null,
        },
      ],
    })
    const prKey = { userId: USER, repoId: REPO_ID, number: 5 }
    expect(await mirrorPr(plugin.db, prKey, withCheck('SUCCESS'), 1)).toEqual({ checksChanged: true })
    expect(await mirrorPr(plugin.db, prKey, withCheck('SUCCESS'), 2)).toEqual({ checksChanged: false })
    expect(await mirrorPr(plugin.db, prKey, withCheck('FAILURE'), 3)).toEqual({ checksChanged: true })

    const emit = vi.fn()
    announcePrSynced(emit, { ...key, number: 5 }, 'abc123', false)
    expect(emit.mock.calls.map(([verb]) => verb)).toEqual(['pr-synced'])
    announcePrSynced(emit, { ...key, number: 5 }, 'abc123', true)
    expect(emit.mock.calls.map(([verb]) => verb)).toEqual(['pr-synced', 'pr-synced', 'checks-changed'])
    expect(emit.mock.calls[2][1]).toEqual({ repoOwner: 'acme', repoName: 'web', pullNumber: 5, headSha: 'abc123' })
  })

  // The guarantee in place of a shared transaction: adoption runs only after the mirror batch
  // commits, so a refresh that never reaches the batch cannot adopt a PR into a task.
  it('does not adopt a PR into a task when the open-PR fetch fails', async () => {
    await core.db.insert(schema.tasks).values({
      id: 'task-1',
      title: 'Feature',
      origin: 'local',
      projectId: 'project-web',
      branch: 'feature',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })
    const adopt = vi.spyOn(tasks, 'adoptChangeRequests')
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 500 }))

    const result = await refreshOpenPulls('token', plugin.db, { tasks }, key, fetcher)

    expect(result.ok).toBe(false)
    expect(adopt).not.toHaveBeenCalled()
    expect((await core.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-1')))[0].pullNumber).toBeNull()
    expect(await plugin.db.select().from(pullRequests)).toEqual([])
  })

  // Idempotence is what makes "after the batch" safe. A crash between the mirror commit and the
  // adoption self-heals on the next refresh, and re-running never steals a PR number from a task that
  // has one, or from a branch nobody is on.
  it('re-adopting is idempotent and never overwrites a task that already has a PR', async () => {
    await core.db.insert(schema.tasks).values([
      {
        id: 'task-adopt',
        title: 'Adopt me',
        origin: 'local',
        projectId: 'project-web',
        branch: 'feature',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'task-taken',
        title: 'Already has one',
        origin: 'local',
        projectId: 'project-web',
        branch: 'feature',
        pullNumber: 99,
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'task-other',
        title: 'Different branch',
        origin: 'local',
        projectId: 'project-web',
        branch: 'other',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    // The primary as core stores it, beside the copy in `tasks.pull_number`.
    await core.db.insert(schema.taskChangeRequests).values({
      taskId: 'task-taken',
      provider: 'github',
      repoHost: 'github.com',
      repoPath: 'acme/web',
      number: 99,
      role: 'primary',
      provenance: 'task',
      createdAt: 1,
    })
    const fetcher = vi.fn(async () =>
      json(
        [
          {
            number: 5,
            node_id: 'PR_5',
            state: 'open',
            draft: false,
            title: 'Fresh',
            head: { ref: 'feature' },
            base: { ref: 'main' },
            user: { login: USER },
            updated_at: '2026-07-11T00:00:00Z',
          },
        ],
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
})
