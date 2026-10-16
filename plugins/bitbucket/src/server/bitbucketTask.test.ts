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
import { FAKE_AUTH, makeFakeBitbucket, makePullRequest, type FakeRepository } from './fakeBitbucket.helper'
import { refreshFiles, refreshPullRequest } from './mirror/detail'
import { changeRequestRoutes } from './routes/changeRequests'
import { bitbucketWorkflowPolicies } from './workflowPolicies'
import { createBrowserHandoffHandler } from './browserHandoff'
import { createBitbucketAccount } from './account'

vi.mock('./bitbucketApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bitbucketApi')>()),
  bitbucketSession: async () => ({ auth: FAKE_AUTH }),
}))

// A Bitbucket task end to end, below the UI: the routes core's agent tools ask, the CI policy a workflow
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
const repository = { provider: 'bitbucket', host: 'bitbucket.org', path: 'acme/api', externalId: null }
const core = {
  tasks: {
    load: async (id: string) => (id === task.id ? task : null),
    changeRequests: async () => [
      {
        taskId: task.id,
        provider: 'bitbucket',
        host: 'bitbucket.org',
        path: 'acme/api',
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
const connection = { id: 'conn-1', status: 'connected', label: 'ada', name: null, config: '{}' } as StoredConnection
const account = createBitbucketAccount({ connections: async () => [connection], forgetOthers: async () => {} })
const session = { auth: FAKE_AUTH }
const providers = {
  withConnection: async <T>(
    _userId: string,
    _provider: string,
    visit: (c: StoredConnection, secret: string) => Promise<T | undefined>,
    connectionId?: string,
  ) => (connectionId === connection.id ? visit(connection, FAKE_AUTH) : undefined),
}
const blobs = new Map<string, string>()
const blobStore = {
  get: async (key: string) => blobs.get(key) ?? null,
  put: async (key: string, value: string) => void blobs.set(key, value),
}

describe('a Bitbucket task', () => {
  let testDb: TestPluginDb
  let fake: ReturnType<typeof makeFakeBitbucket>
  let repo: FakeRepository

  beforeEach(async () => {
    await account.sync()
    testDb = makeTestPluginDb('bitbucket')
    repo = { path: 'acme/api', defaultBranch: 'main', pullRequests: [makePullRequest()] }
    fake = makeFakeBitbucket([repo])
    vi.stubGlobal('fetch', fake.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.cleanup()
  })

  const key = { connectionId: connection.id, repository: 'acme/api', number: 12 }
  const mirror = async () => {
    await refreshPullRequest(session, testDb.db, key)
    await refreshFiles(session, testDb.db, blobStore, key)
  }
  const TASK: Principal = { kind: 'internal', scope: 'task', userId: USER, taskId: task.id } as Principal
  const call = async (path: string, init: RequestInit = {}, principal = TASK) => {
    const app = new Hono<AppEnv>()
      .use('/api/*', ...testGate(principal))
      .route('/api/cr', changeRequestRoutes(testDb.db, core, account))
    const response = await app.fetch(new Request(`http://acorn.test/api/cr${path}`, init), {} as Env)
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  it("answers core's agent tools from the mirror, and nothing before it holds the pull request", async () => {
    expect((await call('/12?taskId=task-1')).status).toBe(404)
    repo.pullRequests[0] = makePullRequest({
      statuses: [
        { key: 'test', name: 'test', state: 'FAILED', commit: 'a'.repeat(40) },
        { key: 'build', name: 'build', state: 'INPROGRESS', commit: 'a'.repeat(40) },
      ],
      comments: [
        {
          id: 3,
          body: 'Rename',
          author: 'grace',
          createdOn: '2026-10-16T00:00:00Z',
          inline: { path: 'src/app.ts', to: 1 },
        },
        {
          id: 4,
          body: 'Fixed',
          author: 'grace',
          createdOn: '2026-10-16T00:01:00Z',
          inline: { path: 'src/app.ts', to: 2 },
          resolved: true,
        },
      ],
    })
    await mirror()
    expect((await call('/12?taskId=task-1')).body).toEqual({
      number: 12,
      title: 'Fix the importer',
      body: expect.stringContaining('https://bitbucket.org/acme/api/issues/3'),
      changedFiles: ['src/app.ts'],
    })
    expect((await call('/12/checks?taskId=task-1')).body).toMatchObject({ failing: ['test'], pending: ['build'] })
    const feedback = (await call('/12/feedback?taskId=task-1')).body as { threads: { threadId: string }[] }
    expect(feedback.threads.map((thread) => thread.threadId)).toEqual(['3'])
    expect(((await call('/12/feedback?taskId=task-1&includeResolved=true')).body.threads as unknown[]).length).toBe(2)
  })

  it("opens a pull request from the task's branch, as the Node", async () => {
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
    expect(repo.pullRequests.at(-1)).toMatchObject({
      title: 'Add it',
      sourceBranch: 'add-it',
      destinationBranch: 'main',
      draft: true,
    })
  })

  it("makes checks-green wait for the head commit's build statuses, then fail on a failed one, then pass", async () => {
    const { ciSettled } = bitbucketWorkflowPolicies(testDb.db, core, providers, account, () => {})
    const evaluate = () => ciSettled.evaluate({ taskId: task.id, with: {}, since: 0 } as never)
    const pull = repo.pullRequests[0]!
    pull.statuses = [
      { key: 'test', name: 'test', state: 'INPROGRESS', commit: 'a'.repeat(40) },
      { key: 'lint', name: 'lint', state: 'SUCCESSFUL', commit: 'a'.repeat(40) },
    ]
    expect(await evaluate()).toMatchObject({ verdict: 'wait', detail: 'Builds running: 1 of 2 finished.' })
    pull.statuses[0]!.state = 'FAILED'
    expect(await evaluate()).toMatchObject({
      verdict: 'fail',
      value: { failing: [{ name: 'test', status: 'failure' }] },
    })
    pull.statuses[0]!.state = 'SUCCESSFUL'
    expect(await evaluate()).toMatchObject({ verdict: 'pass', detail: 'All 2 builds passed.' })
    // A push moves the head, and the statuses on the old one no longer count.
    pull.headSha = 'e'.repeat(40)
    pull.commits = [{ hash: 'e'.repeat(40), message: 'More', author: 'ada', date: '2026-10-16T01:00:00Z' }]
    expect(await evaluate()).toMatchObject({
      verdict: 'wait',
      detail: 'The build statuses are still for an older commit.',
    })
    pull.statuses = []
    expect(await evaluate()).toMatchObject({ verdict: 'fail', detail: 'The pull request has no build statuses.' })
  })

  it('makes review-received pass on a verdict or a comment by someone else after the wait began', async () => {
    const { reviewReceived } = bitbucketWorkflowPolicies(testDb.db, core, providers, account, () => {})
    const evaluate = () =>
      reviewReceived.evaluate({ taskId: task.id, with: {}, since: Date.parse('2026-10-16T00:05:00Z') } as never)
    expect(await evaluate()).toMatchObject({ verdict: 'wait' })
    repo.pullRequests[0]!.participants[0] = {
      nickname: 'grace',
      role: 'REVIEWER',
      approved: false,
      state: 'changes_requested',
      participatedOn: '2026-10-16T00:06:00Z',
    }
    expect(await evaluate()).toMatchObject({ verdict: 'pass', detail: 'Reviewed by grace.' })
  })

  it("resolves a fork's pull request page into a task seed that checks out the fork's branch", async () => {
    repo.pullRequests[0] = makePullRequest({ sourceBranch: 'patch-1', sourceRepository: 'Alice/API' })
    const handler = createBrowserHandoffHandler(testDb.db, core, () => {})
    const context = {
      userId: USER,
      principal: { kind: 'device', userId: USER },
      providers: {
        withConnections: async <T>(
          _provider: string,
          visit: (c: StoredConnection, secret: string) => Promise<T | undefined>,
        ) => {
          const value = await visit(connection, FAKE_AUTH)
          return value === undefined ? [] : [value]
        },
      },
    } as unknown as PluginRequestContext
    const response = await handler(
      new Request('http://acorn.test/browser/pull-request', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://bitbucket.org/acme/api/pull-requests/12/diff',
          captures: { workspace: 'acme', repo: 'api', number: '12', tab: 'diff' },
        }),
      }),
      context,
    )
    const { items } = (await response.json()) as { items: Record<string, unknown>[] }
    expect(items).toEqual([
      expect.objectContaining({
        identifier: 'acme/api#12',
        url: 'https://bitbucket.org/acme/api/pull-requests/12',
        projects: ['project-1'],
        seed: {
          origin: 'bitbucket-pr',
          title: 'Fix the importer',
          branch: 'patch-1',
          changeRequest: { number: 12, sourceBranch: 'patch-1', sourceRepository: 'alice/api' },
          links: [
            {
              connectionId: 'conn-1',
              identifier: 'acme/api#12',
              ref: { displayId: 'acme/api#12', url: 'https://bitbucket.org/acme/api/pull-requests/12' },
            },
          ],
        },
      }),
    ])
  })
})
