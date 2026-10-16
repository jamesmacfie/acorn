import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeTestPluginDb,
  testGate,
  type AppEnv,
  type Env,
  type Principal,
  type TestPluginDb,
} from '@acorn/plugin-api/testkit'
import type { CoreServices, PluginRequestContext, StoredConnection } from '@acorn/plugin-api/node'
import { makeFakeGitlab, makeMergeRequest, type FakeProject } from './fakeGitlab.helper'
import { refreshFiles, refreshMergeRequest } from './mirror/detail'
import { resolveProject } from './mirror/projects'
import { changeRequestRoutes } from './routes/changeRequests'
import { gitlabWorkflowPolicies } from './workflowPolicies'
import { createBrowserHandoffHandler } from './browserHandoff'

vi.mock('./gitlabApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gitlabApi')>()),
  gitlabSession: async () => ({ token: 'token' }),
}))

// A GitLab task end to end, below the UI: the routes core's agent tools ask, the CI policy a workflow
// waits on, and the browser button, all over the mirror the fake fills.

const USER = 'owner'
const task = {
  id: 'task-1',
  title: 'Task',
  projectId: 'project-1',
  branch: 'fix-importer',
  worktreePath: null,
  pullNumber: null,
}
const repository = { provider: 'gitlab', host: 'gitlab.com', path: 'group/sub/api', externalId: '42' }
const core = {
  tasks: {
    load: async (id: string) => (id === task.id ? task : null),
    changeRequests: async () => [
      {
        taskId: task.id,
        provider: 'gitlab',
        host: 'gitlab.com',
        path: 'group/sub/api',
        number: 12,
        role: 'primary',
        provenance: 'task',
      },
    ],
  },
  projects: {
    byId: async (id: string) =>
      id === 'project-1' ? { id, name: 'api', path: '/src/api', workspaceId: 'w', repository, github: null } : null,
    checkouts: async () => [{ id: 'project-1', path: '/src/api' }],
  },
  identity: { active: () => USER },
} as unknown as Pick<CoreServices, 'tasks' | 'projects' | 'identity'>
const connection = { id: 'conn-1', status: 'connected', label: 'ada', name: null } as StoredConnection
const providers = {
  withConnection: async <T>(
    _userId: string,
    _provider: string,
    visit: (c: StoredConnection, secret: string) => Promise<T | undefined>,
  ) => visit(connection, 'token'),
}
const blobs = new Map<string, string>()
const blobStore = {
  get: async (key: string) => blobs.get(key) ?? null,
  put: async (key: string, value: string) => void blobs.set(key, value),
}

describe('a GitLab task', () => {
  let testDb: TestPluginDb
  let fake: ReturnType<typeof makeFakeGitlab>
  let project: FakeProject

  beforeEach(() => {
    testDb = makeTestPluginDb('gitlab')
    project = { id: 42, path: 'group/sub/api', defaultBranch: 'main', mergeRequests: [makeMergeRequest()] }
    fake = makeFakeGitlab([project])
    vi.stubGlobal('fetch', fake.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.cleanup()
  })

  const mirror = async () => {
    await resolveProject({ token: 'token' }, testDb.db, USER, 'group/sub/api')
    const key = { userId: USER, projectId: 42, path: 'group/sub/api', iid: 12 }
    await refreshMergeRequest({ token: 'token' }, testDb.db, key)
    await refreshFiles({ token: 'token' }, testDb.db, blobStore, key)
  }
  const TASK: Principal = { kind: 'internal', scope: 'task', userId: USER, taskId: task.id } as Principal
  const call = async (path: string, init: RequestInit = {}, principal = TASK) => {
    const app = new Hono<AppEnv>()
      .use('/api/*', ...testGate(principal))
      .route('/api/cr', changeRequestRoutes(testDb.db, core))
    const response = await app.fetch(new Request(`http://acorn.test/api/cr${path}`, init), {} as Env)
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  it("answers core's agent tools from the mirror, and nothing before it holds the merge request", async () => {
    expect((await call('/12?taskId=task-1')).status).toBe(404)
    project.mergeRequests[0] = makeMergeRequest({
      pipeline: {
        sha: 'a'.repeat(40),
        jobs: [
          { id: 1, name: 'test', status: 'FAILED' },
          { id: 2, name: 'build', status: 'RUNNING' },
        ],
      },
      discussions: [
        {
          id: 'd1',
          resolved: false,
          notes: [
            {
              id: 3,
              body: 'Rename',
              author: 'grace',
              createdAt: '2026-10-16T00:00:00Z',
              position: { path: 'src/app.ts', newLine: 1, headSha: 'a'.repeat(40) },
            },
          ],
        },
        {
          id: 'd2',
          resolved: true,
          notes: [
            {
              id: 4,
              body: 'Fixed',
              author: 'grace',
              createdAt: '2026-10-16T00:01:00Z',
              position: { path: 'src/app.ts', newLine: 2, headSha: 'a'.repeat(40) },
            },
          ],
        },
      ],
    })
    await mirror()
    expect((await call('/12?taskId=task-1')).body).toEqual({
      number: 12,
      title: 'Fix the importer',
      body: expect.stringContaining('https://gitlab.com/group/sub/api/-/issues/3'),
      changedFiles: ['src/app.ts'],
    })
    expect((await call('/12/checks?taskId=task-1')).body).toMatchObject({ failing: ['test'], pending: ['build'] })
    const feedback = (await call('/12/feedback?taskId=task-1')).body as { threads: { threadId: string }[] }
    expect(feedback.threads.map((thread) => thread.threadId)).toEqual(['d1'])
    expect(((await call('/12/feedback?taskId=task-1&includeResolved=true')).body.threads as unknown[]).length).toBe(2)
  })

  it("opens a merge request from the task's branch, into the default branch", async () => {
    await mirror()
    const NODE: Principal = { kind: 'internal', scope: 'service', userId: USER } as Principal
    const created = await call(
      '',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, title: 'Add it', base: 'main', head: 'add-it', draft: true }),
      },
      NODE,
    )
    expect(created).toEqual({ status: 200, body: { number: 13 } })
    expect(project.mergeRequests.at(-1)).toMatchObject({
      title: 'Draft: Add it',
      sourceBranch: 'add-it',
      targetBranch: 'main',
    })
  })

  it('makes checks-green wait for the pipeline, then fail on a failed job, then pass', async () => {
    await mirror()
    const { ciSettled } = gitlabWorkflowPolicies(testDb.db, core, providers, () => {})
    const evaluate = () => ciSettled.evaluate({ taskId: task.id, with: {}, since: 0 } as never)
    const pipeline = project.mergeRequests[0]!.pipeline!
    pipeline.jobs = [
      { id: 1, name: 'test', status: 'RUNNING' },
      { id: 2, name: 'lint', status: 'SUCCESS' },
    ]
    expect(await evaluate()).toMatchObject({ verdict: 'wait', detail: 'Jobs running: 1 of 2 finished.' })
    pipeline.jobs[0]!.status = 'FAILED'
    expect(await evaluate()).toMatchObject({
      verdict: 'fail',
      value: { failing: [{ name: 'test', status: 'failure' }] },
    })
    pipeline.jobs[0]!.status = 'SUCCESS'
    expect(await evaluate()).toMatchObject({ verdict: 'pass', detail: 'All 2 jobs passed.' })
    pipeline.sha = 'e'.repeat(40)
    expect(await evaluate()).toMatchObject({ verdict: 'wait', detail: 'The pipeline is still for an older commit.' })
  })

  it('makes review-received pass on an approval or a comment by someone else after the wait began', async () => {
    await mirror()
    const { reviewReceived } = gitlabWorkflowPolicies(testDb.db, core, providers, () => {})
    const evaluate = () =>
      reviewReceived.evaluate({ taskId: task.id, with: {}, since: Date.parse('2026-10-16T00:05:00Z') } as never)
    expect(await evaluate()).toMatchObject({ verdict: 'wait' })
    const mr = project.mergeRequests[0]!
    mr.discussions.push({
      id: 's1',
      resolved: false,
      notes: [
        {
          id: 9,
          body: 'approved this merge request',
          author: 'grace',
          createdAt: '2026-10-16T00:06:00Z',
          system: true,
        },
      ],
    })
    mr.approvedBy = ['grace']
    expect(await evaluate()).toMatchObject({ verdict: 'pass', detail: 'Reviewed by grace.' })
  })

  it('resolves a merge request page into a task seed with the merge request as its primary', async () => {
    const handler = createBrowserHandoffHandler(testDb.db, core, () => {})
    const context = {
      userId: USER,
      principal: { kind: 'device', userId: USER },
      providers: {
        withConnections: async <T>(
          _provider: string,
          visit: (c: StoredConnection, secret: string) => Promise<T | undefined>,
        ) => {
          const value = await visit(connection, 'token')
          return value === undefined ? [] : [value]
        },
      },
    } as unknown as PluginRequestContext
    const response = await handler(
      new Request('http://acorn.test/browser/merge-request', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://gitlab.com/Group/Sub/API/-/merge_requests/12',
          captures: { path: 'Group/Sub/API', number: '12' },
        }),
      }),
      context,
    )
    const { items } = (await response.json()) as { items: Record<string, unknown>[] }
    expect(items).toEqual([
      expect.objectContaining({
        identifier: 'group/sub/api!12',
        url: 'https://gitlab.com/group/sub/api/-/merge_requests/12',
        projects: ['project-1'],
        seed: {
          origin: 'gitlab-mr',
          title: 'Fix the importer',
          branch: 'fix-importer',
          changeRequest: { number: 12 },
          links: [
            {
              connectionId: 'conn-1',
              identifier: 'group/sub/api!12',
              ref: { displayId: 'group/sub/api!12', url: 'https://gitlab.com/group/sub/api/-/merge_requests/12' },
            },
          ],
        },
      }),
    ])
  })
})
