import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices, StoredConnection } from '@acorn/plugin-api/node'
import { refreshPullDetail } from './routes/pulls/pullRefresh'
import { githubWorkflowPolicies } from './workflowPolicies'
import { checks, comments, pullRequests, repos, reviews, reviewThreads } from '../node/schema'

// The refresh is GitHub's network call. Each test says what it answered; the reads that follow run over
// a real mirror database.
vi.mock('./routes/pulls/pullRefresh', () => ({ refreshPullDetail: vi.fn() }))

const USER = 'owner'
const task = { id: 'task-1', projectId: 'project-1', pullNumber: 7 }
const project = { id: 'project-1', github: { owner: 'acme', name: 'widget', repoId: 1 } }
const pull = { userId: USER, repoId: 1, number: 7 }

describe('the GitHub workflow policies', () => {
  let testDb: TestPluginDb
  const connect = async <T>(
    _userId: string,
    _provider: string,
    visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>,
  ): Promise<T | undefined> => (connected ? visit({ id: 'github-1' } as StoredConnection, 'token') : undefined)
  let connected = true
  const policies = (taskOverride: Partial<typeof task> = {}) =>
    githubWorkflowPolicies(
      testDb.db,
      {
        tasks: { load: async () => ({ ...task, ...taskOverride }) },
        projects: { byId: async () => project },
        identity: { active: () => USER },
      } as unknown as Pick<CoreServices, 'tasks' | 'projects' | 'identity'>,
      { withConnection: connect },
      () => {},
    )
  const ask = (policy: 'ciSettled' | 'reviewReceived', settings: Record<string, unknown> = {}, since = 0) =>
    policies()[policy].evaluate({ taskId: 'task-1', with: settings, since, signal: new AbortController().signal })
  const check = (name: string, status: string | null, position: number) => ({
    ...pull,
    name,
    status,
    url: null,
    runId: null,
    position,
  })

  beforeEach(async () => {
    testDb = makeTestPluginDb('github')
    await testDb.db
      .insert(repos)
      .values({ userId: USER, id: 1, owner: 'acme', name: 'widget', private: false, fetchedAt: 1 })
    await testDb.db
      .insert(pullRequests)
      .values({ ...pull, state: 'open', title: 'Ship it', author: 'alice', fetchedAt: 1 })
    vi.mocked(refreshPullDetail).mockResolvedValue({ ok: true, headSha: 'abc', checksSha: 'abc' })
    connected = true
  })
  afterEach(() => testDb.cleanup())

  describe('ci-settled', () => {
    it('refreshes the pull request before it reads, and waits while any check is running', async () => {
      await testDb.db.insert(checks).values([check('lint', 'SUCCESS', 0), check('test', 'IN_PROGRESS', 1)])
      expect(await ask('ciSettled')).toMatchObject({ verdict: 'wait', detail: 'Checks running: 1 of 2 finished.' })
      expect(refreshPullDetail).toHaveBeenCalledWith(
        'token',
        testDb.db,
        expect.objectContaining({ ...pull, owner: 'acme', repo: 'widget' }),
        expect.any(Function),
      )
    })

    it('fails with the failing checks once every check has finished, and passes when all passed', async () => {
      await testDb.db.insert(checks).values([check('lint', 'SKIPPED', 0), check('test', 'FAILURE', 1)])
      expect(await ask('ciSettled')).toEqual({
        verdict: 'fail',
        detail: '1 of 2 checks failed: test',
        value: { failing: [{ name: 'test', status: 'FAILURE', url: null }], pending: [], total: 2 },
      })
      await testDb.db.delete(checks)
      await testDb.db.insert(checks).values([check('lint', 'SUCCESS', 0), check('test', 'NEUTRAL', 1)])
      expect(await ask('ciSettled')).toMatchObject({ verdict: 'pass', detail: 'All 2 checks passed.' })
    })

    it('waits while the checks belong to an older commit than the head', async () => {
      vi.mocked(refreshPullDetail).mockResolvedValue({ ok: true, headSha: 'new', checksSha: 'old' })
      await testDb.db.insert(checks).values([check('test', 'FAILURE', 0)])
      expect(await ask('ciSettled')).toMatchObject({ verdict: 'wait' })
    })

    it('fails on no checks unless told to wait for them, and fails on no pull request', async () => {
      expect(await ask('ciSettled')).toMatchObject({ verdict: 'fail', detail: 'The pull request has no checks.' })
      expect(await ask('ciSettled', { missing: 'wait' })).toMatchObject({ verdict: 'wait' })
      const noPull = await policies({ pullNumber: null as unknown as number }).ciSettled.evaluate({
        taskId: 'task-1',
        with: {},
        since: 0,
        signal: new AbortController().signal,
      })
      expect(noPull.verdict).toBe('fail')
    })

    it('waits when a push lands mid-read, and throws on other refresh failures so the gate retries', async () => {
      vi.mocked(refreshPullDetail).mockResolvedValue({
        ok: false,
        failure: { error: 'github_revision_changed', status: 502 },
      })
      expect(await ask('ciSettled')).toMatchObject({ verdict: 'wait' })
      vi.mocked(refreshPullDetail).mockResolvedValue({
        ok: false,
        failure: { error: 'github_unauthorized', status: 401 },
      })
      await expect(ask('ciSettled')).rejects.toThrow('GitHub refresh failed: github_unauthorized')
      connected = false
      await expect(ask('ciSettled')).rejects.toThrow('GitHub is not connected.')
    })
  })

  describe('review-received', () => {
    const SINCE = 1_000

    it('waits until someone other than the author or a bot comments after the wait started', async () => {
      await testDb.db.insert(comments).values([
        { ...pull, id: 'c1', author: 'bob', body: 'Before', createdAt: SINCE - 1, position: 0 },
        { ...pull, id: 'c2', author: 'alice', body: 'Author', createdAt: SINCE + 1, position: 1 },
        { ...pull, id: 'c3', author: 'ci', authorIsBot: true, body: 'Coverage', createdAt: SINCE + 1, position: 2 },
      ])
      expect(await ask('reviewReceived', {}, SINCE)).toEqual({ verdict: 'wait', detail: 'No review yet.' })
      expect(await ask('reviewReceived', { include_bots: true }, SINCE)).toMatchObject({
        verdict: 'pass',
        detail: 'Reviewed by ci.',
      })
    })

    it('passes on a review or an inline comment, with what they said as its value', async () => {
      await testDb.db.insert(reviews).values({
        ...pull,
        id: 'r1',
        author: 'bob',
        state: 'APPROVED',
        body: '',
        submittedAt: SINCE + 5,
        position: 0,
      })
      await testDb.db.insert(reviewThreads).values({
        ...pull,
        threadId: 't1',
        id: 'tc1',
        path: 'src/a.ts',
        author: 'carol',
        body: 'Rename this',
        createdAt: SINCE + 2,
        position: 0,
      })
      expect(await ask('reviewReceived', {}, SINCE)).toEqual({
        verdict: 'pass',
        detail: 'Reviewed by carol, bob.',
        value: [
          { kind: 'thread-comment', author: 'carol', body: 'Rename this', at: SINCE + 2, path: 'src/a.ts' },
          { kind: 'review', author: 'bob', body: '', at: SINCE + 5, state: 'APPROVED' },
        ],
      })
    })

    it('fails once the pull request is closed or merged', async () => {
      await testDb.db.update(pullRequests).set({ state: 'merged' })
      expect(await ask('reviewReceived', {}, SINCE)).toEqual({
        verdict: 'fail',
        detail: 'The pull request was merged.',
      })
    })
  })
})
