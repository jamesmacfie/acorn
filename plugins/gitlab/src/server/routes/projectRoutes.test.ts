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
import type { CoreServices } from '@acorn/plugin-api/node'
import type { MergeRequestDetail, MergeRequestDiff, MergeRequestRow } from '../../shared/api'
import { makeFakeGitlab, makeMergeRequest, type FakeProject } from '../fakeGitlab.helper'
import { projectReads } from './projectReads'
import { projectWrites } from './projectWrites'
import { createGitlabServers } from '../servers'

vi.mock('../gitlabApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../gitlabApi')>()),
  gitlabSession: async (_c: unknown, server: { origin: string }) => ({ origin: server.origin, token: 'token' }),
}))

const DEVICE: Principal = { kind: 'device', userId: 'owner' } as Principal
const adopted: [string, string, Map<string, number>][] = []
const core = {
  tasks: {
    adoptChangeRequests: async (provider: string, path: string, branches: Map<string, number>) => {
      adopted.push([provider, path, branches])
      return 0
    },
  },
} as unknown as Pick<CoreServices, 'tasks'>

// One gitlab.com connection.
const servers = createGitlabServers({
  connections: async () => [{ id: 'conn-1', config: '{}' }],
  claim: () => ({ dispose: () => {} }),
  forgetOthers: async () => {},
})

const blobs = new Map<string, string>()
const env = {
  BLOBS: {
    get: async (key: string) => blobs.get(key) ?? null,
    put: async (key: string, value: string) => void blobs.set(key, value),
  },
} as unknown as Env

describe('the GitLab project routes, against a fake gitlab.com', () => {
  let testDb: TestPluginDb
  let fake: ReturnType<typeof makeFakeGitlab>
  let project: FakeProject

  beforeEach(async () => {
    testDb = makeTestPluginDb('gitlab')
    blobs.clear()
    adopted.length = 0
    project = { id: 42, path: 'Group/Sub/API', defaultBranch: 'main', mergeRequests: [makeMergeRequest()] }
    fake = makeFakeGitlab([project])
    vi.stubGlobal('fetch', fake.fetch)
    await servers.sync()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.cleanup()
  })

  const app = () =>
    new Hono<AppEnv>()
      .use('/api/*', ...testGate(DEVICE))
      .route('/api/projects', projectReads(testDb.db, servers, { core, maxPages: 5 }))
      .route('/api/projects', projectWrites(testDb.db, servers))
  const call = async <T>(path: string, init: RequestInit = {}) => {
    const response = await app().fetch(new Request(`http://acorn.test/api/projects${path}`, init), env)
    return { status: response.status, body: (await response.json()) as T }
  }
  const post = (body: unknown) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const at = (path: string) => `/gitlab.com/${encodeURIComponent(path)}`

  it("lists the person's projects, in GitLab's spelling", async () => {
    const { status, body } = await call<{ path: string; id: number }[]>('')
    expect(status).toBe(200)
    expect(body).toEqual([expect.objectContaining({ id: 42, path: 'Group/Sub/API', defaultBranch: 'main' })])
  })

  it('lists a project made since the last read when forced', async () => {
    await call('')
    fake.projects.push({ id: 43, path: 'Group/Web', defaultBranch: 'main', mergeRequests: [] })
    const { body } = await call<{ path: string }[]>('?force=true')
    expect(body.map((entry) => entry.path).sort()).toEqual(['Group/Sub/API', 'Group/Web'])
  })

  it('lists the open merge requests of a nested project, whatever the case of its path, and adopts their branches', async () => {
    const { status, body } = await call<MergeRequestRow[]>(`${at('group/sub/api')}/merge-requests?state=open`)
    expect(status).toBe(200)
    expect(body).toEqual([
      expect.objectContaining({
        number: 12,
        title: 'Fix the importer',
        state: 'open',
        headRef: 'fix-importer',
        pipelineStatus: 'in_progress',
      }),
    ])
    expect(adopted).toEqual([['gitlab', 'group/sub/api', new Map([['fix-importer', 12]])]])
  })

  it('reads 200 open merge requests in two GraphQL pages', async () => {
    project.mergeRequests = Array.from({ length: 200 }, (_, index) =>
      makeMergeRequest({
        iid: index + 1,
        sourceBranch: `b${index}`,
        updatedAt: `2026-10-16T00:${String(index % 60).padStart(2, '0')}:00Z`,
      }),
    )
    const started = performance.now()
    const { body } = await call<MergeRequestRow[]>(`${at('group/sub/api')}/merge-requests?state=open`)
    expect(body).toHaveLength(200)
    expect(fake.requests.filter((request) => request.operation === 'MergeRequests')).toHaveLength(2)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('answers a merge request in the shared model: approvals, reviewers, threads, checks, and standalone HTML', async () => {
    project.mergeRequests[0] = makeMergeRequest({
      approvedBy: ['grace'],
      pipeline: {
        sha: 'a'.repeat(40),
        jobs: [
          { id: 501, name: 'test', status: 'FAILED' },
          { id: 502, name: 'lint', status: 'FAILED', allowFailure: true },
          { id: 503, name: 'deploy', status: 'MANUAL' },
        ],
      },
      discussions: [
        {
          id: 'c1',
          resolved: false,
          notes: [{ id: 1, body: 'Looks good', author: 'grace', createdAt: '2026-10-16T00:10:00Z' }],
        },
        {
          id: 's1',
          resolved: false,
          notes: [
            {
              id: 2,
              body: 'approved this merge request',
              author: 'grace',
              createdAt: '2026-10-16T00:11:00Z',
              system: true,
            },
          ],
        },
        {
          id: 'd1',
          resolved: true,
          notes: [
            {
              id: 3,
              body: 'Rename this',
              author: 'grace',
              createdAt: '2026-10-16T00:12:00Z',
              position: { path: 'src/app.ts', newLine: 1, headSha: 'a'.repeat(40) },
            },
            {
              id: 4,
              body: 'Done',
              author: 'ada',
              createdAt: '2026-10-16T00:13:00Z',
              position: { path: 'src/app.ts', newLine: 1, headSha: 'a'.repeat(40) },
            },
          ],
        },
        {
          id: 'd2',
          resolved: false,
          notes: [
            {
              id: 5,
              body: 'Old',
              author: 'grace',
              createdAt: '2026-10-16T00:14:00Z',
              position: { path: 'src/app.ts', oldLine: 2, headSha: 'f'.repeat(40) },
            },
          ],
        },
      ],
    })
    const { status, body } = await call<MergeRequestDetail>(`${at('group/sub/api')}/merge-requests/12`)
    expect(status).toBe(200)
    expect(body.revision).toBe(`${'b'.repeat(40)}:${'a'.repeat(40)}`)
    expect(body.request).toMatchObject({
      number: 12,
      state: 'open',
      headRef: 'fix-importer',
      baseRef: 'main',
      conflicting: false,
    })
    expect(body.request?.body).toContain('href="https://gitlab.com/group/sub/api/-/issues/3"')
    expect(body.request?.body).toContain('src="https://gitlab.com/uploads/a.png"')
    expect(body.request?.body).not.toContain('data:image')
    expect(body.reviews).toEqual([
      {
        id: 'approval:grace',
        author: 'grace',
        state: 'approved',
        body: null,
        submittedAt: Date.parse('2026-10-16T00:11:00Z'),
      },
    ])
    expect(body.reviewers).toEqual(['grace'])
    expect(body.labels).toEqual([{ name: 'bug', color: '#dc143c' }])
    expect(body.comments).toEqual([
      { id: '1', author: 'grace', body: '<p>Looks good</p>', createdAt: Date.parse('2026-10-16T00:10:00Z') },
    ])
    expect(
      body.threads.map((thread) => [
        thread.threadId,
        thread.side,
        thread.line,
        thread.outdated,
        thread.resolved,
        thread.comments.length,
      ]),
    ).toEqual([
      ['d1', 'new', 1, false, true, 2],
      ['d2', 'old', 2, true, false, 1],
    ])
    expect(body.threads[0]!.comments[0]).toMatchObject({ databaseId: 3, author: 'grace' })
    expect(body.checks).toEqual([
      { name: 'test', status: 'failure', url: 'https://gitlab.com/Group/Sub/API/-/jobs/501', runId: 501 },
      { name: 'lint', status: 'neutral', url: 'https://gitlab.com/Group/Sub/API/-/jobs/502', runId: 502 },
      { name: 'deploy', status: 'skipped', url: 'https://gitlab.com/Group/Sub/API/-/jobs/503', runId: 503 },
    ])
    expect(body.avatars.grace).toBe('https://gitlab.com/uploads/-/system/user/avatar/grace.png')
  })

  it('answers the diff as a document at the same revision, and its segments by digest', async () => {
    const { body: diff } = await call<MergeRequestDiff>(`${at('group/sub/api')}/merge-requests/12/diff`)
    expect(diff.revision).toBe(`${'b'.repeat(40)}:${'a'.repeat(40)}`)
    const file = diff.document.files[0]!
    expect(file).toMatchObject({
      path: 'src/app.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      sha: 'a'.repeat(40),
    })
    const { status, body } = await call<{ rows: { raw: string }[] }[]>(
      `${at('group/sub/api')}/diff/segments`,
      post({ requests: [{ path: file.path, patchKey: file.patchKey, ordinal: 0 }] }),
    )
    expect(status).toBe(200)
    expect(body[0]!.rows.map((row) => row.raw)).toEqual(expect.arrayContaining(['old', 'new', 'same']))
  })

  it('replies to a thread through its discussion, and places a new note by the three diff commits', async () => {
    project.mergeRequests[0]!.discussions = [
      {
        id: 'd1',
        resolved: false,
        notes: [
          {
            id: 3,
            body: 'Why?',
            author: 'grace',
            createdAt: '2026-10-16T00:12:00Z',
            position: { path: 'src/app.ts', newLine: 1, headSha: 'a'.repeat(40) },
          },
        ],
      },
    ]
    await call(`${at('group/sub/api')}/merge-requests/12`)
    expect(
      (await call(`${at('group/sub/api')}/merge-requests/12/notes/3/replies`, post({ body: 'Because' }))).status,
    ).toBe(200)
    expect(fake.requests.at(-2)).toMatchObject({
      method: 'POST',
      path: '/projects/Group%2FSub%2FAPI/merge_requests/12/discussions/d1/notes',
    })

    expect(
      (
        await call(
          `${at('group/sub/api')}/merge-requests/12/notes`,
          post({ body: 'Nit', path: 'src/app.ts', oldLine: null, newLine: 1 }),
        )
      ).status,
    ).toBe(200)
    const created = fake.requests.find(
      (request) => request.path.endsWith('/merge_requests/12/discussions') && request.method === 'POST',
    )
    expect(created?.body).toEqual({
      body: 'Nit',
      position: {
        position_type: 'text',
        base_sha: 'b'.repeat(40),
        start_sha: 's'.repeat(40),
        head_sha: 'a'.repeat(40),
        old_path: 'src/app.ts',
        new_path: 'src/app.ts',
        new_line: 1,
      },
    })
    const { body } = await call<MergeRequestDetail>(`${at('group/sub/api')}/merge-requests/12`)
    expect(body.threads.map((thread) => thread.comments.map((comment) => comment.body))).toEqual([
      ['<p>Why?</p>', '<p>Because</p>'],
      ['<p>Nit</p>'],
    ])
  })

  it('approves, comments, labels, asks a reviewer, marks a draft, and merges, then re-reads the merge request', async () => {
    const base = `${at('group/sub/api')}/merge-requests/12`
    for (const [path, body] of [
      ['approve', {}],
      ['comments', { body: 'Thanks' }],
      ['labels', { name: 'docs' }],
      ['reviewers', { login: 'ada' }],
      ['draft', { draft: true }],
    ] as const)
      expect((await call(`${base}/${path}`, post(body))).status).toBe(200)
    const { body } = await call<MergeRequestDetail>(base)
    expect(body.reviews.map((review) => review.author)).toEqual(['ada'])
    expect(body.comments.map((comment) => comment.body)).toEqual(['<p>Thanks</p>'])
    expect(body.labels.map((label) => label.name)).toEqual(['bug', 'docs'])
    expect(body.reviewers).toEqual(['grace', 'ada'])
    expect(body.request?.draft).toBe(true)

    project.mergeRequests[0]!.conflicts = true
    expect(await call(`${base}/merge`, post({ method: 'squash' }))).toMatchObject({
      status: 403,
      body: { error: { code: 'merge_failed' } },
    })
    project.mergeRequests[0]!.conflicts = false
    expect((await call(`${base}/merge`, post({ method: 'squash' }))).status).toBe(200)
    expect(fake.requests.find((request) => request.path.endsWith('/merge') && request.method === 'PUT')?.body).toEqual({
      squash: true,
    })
    expect((await call<MergeRequestDetail>(base)).body.request?.state).toBe('merged')
  })

  it('reads a job log and retries a job', async () => {
    expect((await call<{ text: string }>(`${at('group/sub/api')}/jobs/501/log`)).body.text).toContain('running test')
    expect((await call(`${at('group/sub/api')}/jobs/501/retry`, post({}))).status).toBe(200)
  })

  it('refuses everything once GitLab refuses the token, and says to reconnect', async () => {
    fake.tokens.clear()
    expect(await call(`${at('group/sub/api')}/merge-requests/12`)).toMatchObject({
      status: 401,
      body: { error: { code: 'reauth' } },
    })
  })
})
