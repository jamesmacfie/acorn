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
import type { PullRequestDetail, PullRequestDiff, PullRequestList } from '../../shared/api'
import { FAKE_AUTH, makeFakeBitbucket, makePullRequest, type FakeRepository } from '../fakeBitbucket.helper'
import { splitDiff } from '../mirror/detail'
import { repositoryReads } from './repositoryReads'
import { repositoryWrites } from './repositoryWrites'
import { createBitbucketAccount } from '../account'

vi.mock('../bitbucketApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bitbucketApi')>()),
  bitbucketSession: async () => ({ auth: FAKE_AUTH }),
}))

const DEVICE: Principal = { kind: 'device', userId: 'owner' } as Principal
const adopted: [string, string, Map<string, unknown>][] = []
const core = {
  tasks: {
    adoptChangeRequests: async (provider: string, path: string, branches: Map<string, unknown>) => {
      adopted.push([provider, path, branches])
      return 0
    },
  },
} as unknown as Pick<CoreServices, 'tasks'>

const account = createBitbucketAccount({ connections: async () => [{ id: 'conn-1' }], forgetOthers: async () => {} })

const blobs = new Map<string, string>()
const env = {
  BLOBS: {
    get: async (key: string) => blobs.get(key) ?? null,
    put: async (key: string, value: string) => void blobs.set(key, value),
  },
} as unknown as Env

describe('the Bitbucket repository routes, against a fake bitbucket.org', () => {
  let testDb: TestPluginDb
  let fake: ReturnType<typeof makeFakeBitbucket>
  let repository: FakeRepository

  beforeEach(async () => {
    testDb = makeTestPluginDb('bitbucket')
    blobs.clear()
    adopted.length = 0
    repository = { path: 'Acme/API', defaultBranch: 'main', pullRequests: [makePullRequest()] }
    fake = makeFakeBitbucket([repository])
    vi.stubGlobal('fetch', fake.fetch)
    await account.sync()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.cleanup()
  })

  const app = () =>
    new Hono<AppEnv>()
      .use('/api/*', ...testGate(DEVICE))
      .route('/api/repositories', repositoryReads(testDb.db, account, { core, maxPages: 5 }))
      .route('/api/repositories', repositoryWrites(testDb.db, account))
  const call = async <T>(path: string, init: RequestInit = {}) => {
    const response = await app().fetch(new Request(`http://acorn.test/api/repositories${path}`, init), env)
    return { status: response.status, body: (await response.json()) as T }
  }
  const write = (body: unknown, method = 'POST') => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const base = '/acme/api/pull-requests/12'

  it("lists the person's repositories, in Bitbucket's spelling", async () => {
    const { status, body } = await call<{ path: string }[]>('')
    expect(status).toBe(200)
    expect(body).toEqual([expect.objectContaining({ path: 'Acme/API', defaultBranch: 'main', private: true })])
  })

  it('lists a repository made since the last read when forced', async () => {
    await call('')
    fake.repositories.push({ path: 'Acme/Web', defaultBranch: 'main', pullRequests: [] })
    const { body } = await call<{ path: string }[]>('?force=true')
    expect(body.map((entry) => entry.path).sort()).toEqual(['Acme/API', 'Acme/Web'])
  })

  it('lists the open pull requests and adopts their branches, a fork with its own repository', async () => {
    repository.pullRequests.push(
      makePullRequest({
        id: 13,
        sourceBranch: 'patch-1',
        sourceRepository: 'alice/api',
        updatedOn: '2026-10-14T00:00:00Z',
      }),
    )
    const { status, body } = await call<PullRequestList>('/acme/api/pull-requests?state=open')
    expect(status).toBe(200)
    expect(body.rows.map((row) => [row.number, row.headRef, row.sourceRepository])).toEqual([
      [12, 'fix-importer', null],
      [13, 'patch-1', 'alice/api'],
    ])
    expect(body.fetchedAt).toBeGreaterThan(Date.now() - 60_000)
    expect(adopted).toEqual([
      [
        'bitbucket',
        'acme/api',
        new Map<string, unknown>([
          ['fix-importer', 12],
          ['patch-1', { number: 13, sourceRepository: 'alice/api' }],
        ]),
      ],
    ])
  })

  // Measured on October 17, 2026: three requests for 100 open pull requests on a cold mirror, one for
  // the repository and two pages of 50. A second read inside the refresh window asks nothing.
  it('reads 100 open pull requests on a cold mirror in three requests', async () => {
    repository.pullRequests = Array.from({ length: 100 }, (_, index) =>
      makePullRequest({
        id: index + 1,
        sourceBranch: `b${index}`,
        updatedOn: `2026-10-16T00:${String(index % 60).padStart(2, '0')}:00Z`,
      }),
    )
    const { body } = await call<PullRequestList>('/acme/api/pull-requests?state=open')
    expect(body.rows).toHaveLength(100)
    expect(fake.requests.map((request) => request.path)).toEqual([
      '/repositories/acme/api',
      '/repositories/acme/api/pullrequests',
      '/repositories/acme/api/pullrequests',
    ])
    await call<PullRequestList>('/acme/api/pull-requests?state=open')
    expect(fake.requests).toHaveLength(3)
  })

  it('answers a pull request in the shared model: verdicts, reviewers, threads, and head statuses', async () => {
    repository.pullRequests[0] = makePullRequest({
      participants: [
        {
          nickname: 'grace',
          role: 'REVIEWER',
          approved: true,
          state: 'approved',
          participatedOn: '2026-10-16T00:11:00Z',
        },
        {
          nickname: 'linus',
          role: 'PARTICIPANT',
          approved: false,
          state: 'changes_requested',
          participatedOn: '2026-10-16T00:12:00Z',
        },
      ],
      statuses: [
        { key: 'build', name: 'Build', state: 'FAILED', commit: 'a'.repeat(40) },
        { key: 'lint', name: 'Lint', state: 'INPROGRESS', commit: 'a'.repeat(40) },
        { key: 'build', name: 'Build', state: 'SUCCESSFUL', commit: 'f'.repeat(40) },
      ],
      comments: [
        { id: 1, body: 'Looks good', author: 'grace', createdOn: '2026-10-16T00:10:00Z' },
        {
          id: 2,
          body: 'Rename this',
          author: 'grace',
          createdOn: '2026-10-16T00:12:00Z',
          inline: { path: 'src/app.ts', to: 1 },
          resolved: true,
        },
        { id: 3, body: 'Done', author: 'ada', createdOn: '2026-10-16T00:13:00Z', parentId: 2 },
        {
          id: 4,
          body: 'Why drop this?',
          author: 'linus',
          createdOn: '2026-10-16T00:14:00Z',
          inline: { path: 'src/app.ts', from: 1 },
        },
        { id: 5, body: 'Draft', author: 'grace', createdOn: '2026-10-16T00:15:00Z', pending: true },
      ],
    })
    const { status, body } = await call<PullRequestDetail>(base)
    expect(status).toBe(200)
    expect(body.revision).toBe(`${'b'.repeat(12)}:${'a'.repeat(40)}`)
    expect(body.request).toMatchObject({
      number: 12,
      state: 'open',
      headRef: 'fix-importer',
      baseRef: 'main',
      headSha: 'a'.repeat(40),
    })
    expect(body.request?.body).toContain('https://bitbucket.org/acme/api/issues/3')
    expect(body.reviews.map((review) => [review.author, review.state])).toEqual([
      ['grace', 'approved'],
      ['linus', 'changes-requested'],
    ])
    expect(body.reviewers).toEqual(['grace'])
    expect(body.labels).toEqual([])
    expect(body.comments).toEqual([
      { id: '1', author: 'grace', body: '<p>Looks good</p>', createdAt: Date.parse('2026-10-16T00:10:00Z') },
    ])
    expect(
      body.threads.map((thread) => [
        thread.threadId,
        thread.side,
        thread.line,
        thread.resolved,
        thread.comments.length,
      ]),
    ).toEqual([
      ['2', 'new', 1, true, 2],
      ['4', 'old', 1, false, 1],
    ])
    expect(body.threads[0]!.comments[1]).toMatchObject({ databaseId: 3, author: 'ada' })
    // Only the head commit's statuses are its checks.
    expect(body.checks).toEqual([
      { name: 'Build', status: 'failure', url: 'https://ci.example/build', runId: null },
      { name: 'Lint', status: 'in_progress', url: 'https://ci.example/lint', runId: null },
    ])
    expect(body.avatars.grace).toBe('https://avatar.example/grace.png')
    expect(body.sourceRepository).toBeNull()
  })

  it('answers the diff as a document at the same revision, and its segments by digest', async () => {
    const { body: diff } = await call<PullRequestDiff>(`${base}/diff`)
    expect(diff.revision).toBe(`${'b'.repeat(12)}:${'a'.repeat(12)}`)
    const file = diff.document.files[0]!
    expect(file).toMatchObject({ path: 'src/app.ts', status: 'modified', additions: 1, deletions: 1 })
    const { status, body } = await call<{ rows: { raw: string }[] }[]>(
      '/acme/api/diff/segments',
      write({ requests: [{ path: file.path, patchKey: file.patchKey, ordinal: 0 }] }),
    )
    expect(status).toBe(200)
    expect(body[0]!.rows.map((row) => row.raw)).toEqual(expect.arrayContaining(['old', 'new', 'same']))
  })

  it('splits a unified diff by file, and leaves a binary or a pure rename without a patch', () => {
    const patches = splitDiff(
      [
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1 +1 @@',
        '-x',
        '+y',
        'diff --git a/gone.ts b/gone.ts',
        'deleted file mode 100644',
        '--- a/gone.ts',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-z',
        'diff --git a/logo.png b/logo.png',
        'Binary files a/logo.png and b/logo.png differ',
        'diff --git a/old.ts b/new.ts',
        'similarity index 100%',
        'rename from old.ts',
        'rename to new.ts',
        '',
      ].join('\n'),
    )
    expect([...patches.keys()]).toEqual(['a.ts', 'gone.ts'])
    expect(patches.get('a.ts')).toBe('@@ -1 +1 @@\n-x\n+y\n')
  })

  it('comments, replies, resolves, places a line comment, and approves, then re-reads the pull request', async () => {
    repository.pullRequests[0]!.comments = [
      {
        id: 2,
        body: 'Why?',
        author: 'grace',
        createdOn: '2026-10-16T00:12:00Z',
        inline: { path: 'src/app.ts', to: 1 },
      },
    ]
    for (const [path, body] of [
      ['comments', { body: 'Thanks' }],
      ['comments/2/replies', { body: 'Because' }],
      ['threads/2/resolve', { resolved: true }],
      ['line-comments', { body: 'Nit', path: 'src/app.ts', oldLine: 3, newLine: null }],
      ['review', { event: 'approve', body: '' }],
    ] as const)
      expect((await call(`${base}/${path}`, write(body))).status).toBe(200)
    expect(fake.requests.find((request) => request.body?.inline)?.body).toEqual({
      content: { raw: 'Nit' },
      inline: { path: 'src/app.ts', from: 3 },
    })
    const { body } = await call<PullRequestDetail>(base)
    expect(body.comments.map((comment) => comment.body)).toEqual(['<p>Thanks</p>'])
    expect(
      body.threads.map((thread) => [thread.threadId, thread.resolved, thread.comments.map((c) => c.body)]),
    ).toEqual([
      ['2', true, ['<p>Why?</p>', '<p>Because</p>']],
      [expect.any(String), false, ['<p>Nit</p>']],
    ])
    expect(body.reviews.map((review) => [review.author, review.state])).toEqual([['ada', 'approved']])
  })

  it('asks for changes with a comment, and rewrites the reviewer list by uuid with the title', async () => {
    expect((await call(`${base}/review`, write({ event: 'request-changes', body: 'Please split this' }))).status).toBe(
      200,
    )
    expect((await call(`${base}/review`, write({ event: 'comment', body: '' }))).status).toBe(400)
    expect((await call(`${base}/reviewers`, write({ login: 'linus' }))).status).toBe(200)
    expect(fake.requests.find((request) => request.method === 'PUT')?.body).toEqual({
      title: 'Fix the importer',
      reviewers: [{ uuid: '{grace-uuid}' }, { uuid: '{linus-uuid}' }],
    })
    expect((await call(`${base}/reviewers`, write({ login: 'grace' }, 'DELETE'))).status).toBe(200)
    const { body } = await call<PullRequestDetail>(base)
    expect(body.reviewers).toEqual(['linus'])
    expect(body.reviews).toEqual([expect.objectContaining({ author: 'ada', state: 'changes-requested' })])
    expect(body.comments.map((comment) => comment.body)).toEqual(['<p>Please split this</p>'])
  })

  it("merges with the chosen strategy, says Bitbucket's reason when it won't, and declines", async () => {
    repository.pullRequests[0]!.mergeRefusal = "You can't merge until you resolve all merge conflicts."
    expect(await call(`${base}/merge`, write({ method: 'squash' }))).toMatchObject({
      status: 403,
      body: { error: { code: 'merge_failed' } },
    })
    delete repository.pullRequests[0]!.mergeRefusal
    expect((await call(`${base}/merge`, write({ method: 'squash' }))).status).toBe(200)
    expect(fake.requests.findLast((request) => request.path.endsWith('/merge'))?.body).toEqual({
      merge_strategy: 'squash',
      close_source_branch: false,
    })
    expect((await call<PullRequestDetail>(base)).body.request?.state).toBe('merged')
    repository.pullRequests.push(makePullRequest({ id: 14 }))
    expect((await call('/acme/api/pull-requests/14/close', write({}))).status).toBe(200)
    expect((await call<PullRequestDetail>('/acme/api/pull-requests/14')).body.request?.state).toBe('closed')
  })

  it('opens a pull request from a branch into the main branch, as a draft when asked', async () => {
    const created = await call('/acme/api/pull-requests', write({ title: 'Add it', head: 'add-it', draft: true }))
    expect(created).toEqual({ status: 200, body: { number: 13 } })
    expect(repository.pullRequests.at(-1)).toMatchObject({
      title: 'Add it',
      sourceBranch: 'add-it',
      destinationBranch: 'main',
      draft: true,
    })
  })

  it('refuses everything once Bitbucket refuses the token, and says to reconnect', async () => {
    fake.credentials.clear()
    expect(await call(base)).toMatchObject({ status: 401, body: { error: { code: 'reauth' } } })
  })
})
