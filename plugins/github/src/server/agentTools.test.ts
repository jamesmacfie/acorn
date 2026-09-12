import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices, PluginDatabase, StoredConnection } from '@acorn/plugin-api/node'
import { createPullRequest } from './createPull'
import { githubAgentTools } from './agentTools'
import { checks, comments, pullRequests, repos, reviews, reviewThreads } from '../node/schema'

vi.mock('./createPull', () => ({ createPullRequest: vi.fn() }))

const task = {
  id: 'task-1', title: 'Task', projectId: 'project-1', branch: 'feat/task', worktreePath: null, pullNumber: null,
}
const project = {
  id: 'project-1', name: 'widget', path: null, workspaceId: 'workspace-1',
  github: { owner: 'acme', name: 'widget', repoId: 1 },
}

describe('github_pull_create agent tool', () => {
  it('creates from the task branch, attaches agent provenance, and announces the change', async () => {
    vi.mocked(createPullRequest).mockResolvedValue({ ok: true, number: 73 })
    const attachPull = vi.fn().mockResolvedValue({
      taskId: 'task-1', repoOwner: 'acme', repoName: 'widget', pullNumber: 73,
      role: 'primary', provenance: 'agent', sessionId: 'session-1',
    })
    const core = {
      tasks: { load: vi.fn().mockResolvedValue(task), attachPull },
      projects: { byId: vi.fn().mockResolvedValue(project) },
    } as unknown as Pick<CoreServices, 'projects' | 'tasks'>
    const providers = {
      withConnection: async <T>(_userId: string, _providerId: string, visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>) =>
        visit({ id: 'github-1' } as StoredConnection, 'token'),
    }
    const onAttached = vi.fn()
    const emit = vi.fn()
    const [tool] = githubAgentTools({} as PluginDatabase, core, providers, onAttached, emit)

    expect(await tool.when?.({ taskId: 'task-1', userLogin: 'owner', sessionId: 'session-1' })).toBe(true)
    await expect(tool.handler(
      { title: 'Ship it', body: 'Details', base: 'main', draft: true },
      { taskId: 'task-1', userLogin: 'owner', sessionId: 'session-1' },
    )).resolves.toEqual({
      number: 73,
      relationship: 'primary',
      pull: { owner: 'acme', repo: 'widget', number: '73' },
    })
    expect(createPullRequest).toHaveBeenCalledWith('token', expect.anything(), 'owner', 'acme', 'widget', {
      title: 'Ship it', body: 'Details', base: 'main', draft: true, head: 'feat/task',
    }, emit)
    expect(attachPull).toHaveBeenCalledWith('task-1', {
      repoOwner: 'acme', repoName: 'widget', pullNumber: 73, sessionId: 'session-1',
    })
    expect(onAttached).toHaveBeenCalledOnce()
  })

  it('is unavailable without a managed session', async () => {
    const core = {
      tasks: { load: vi.fn().mockResolvedValue(task) },
      projects: { byId: vi.fn().mockResolvedValue(project) },
    } as unknown as Pick<CoreServices, 'projects' | 'tasks'>
    const [tool] = githubAgentTools({} as PluginDatabase, core, { withConnection: vi.fn() })

    expect(await tool.when?.({ taskId: 'task-1', userLogin: 'owner' })).toBe(false)
    await expect(tool.handler(
      { title: 'Ship it', base: 'main' },
      { taskId: 'task-1', userLogin: 'owner' },
    )).rejects.toThrow(/managed agent session/)
  })
})

// The two mirror reads. Real rows in this plugin's own migrated SQLite file, because the grouping of
// inline comments back into threads and the "absent is not empty" answer are both worth pinning.
describe('the pull-request read tools', () => {
  const USER = 'owner'
  let testDb: TestPluginDb

  beforeEach(async () => {
    testDb = makeTestPluginDb('github')
    await testDb.db.insert(repos).values({ userId: USER, id: 1, owner: 'acme', name: 'widget', private: false, fetchedAt: 1 })
    await testDb.db.insert(pullRequests).values({ userId: USER, repoId: 1, number: 7, state: 'open', title: 'Ship it', fetchedAt: 1 })
  })

  afterEach(() => testDb.cleanup())

  const tools = () => {
    const core = {
      tasks: { load: async () => ({ ...task, pullNumber: 7 }) },
      projects: { byId: async () => project },
    } as unknown as Pick<CoreServices, 'projects' | 'tasks'>
    const built = githubAgentTools(testDb.db, core, { withConnection: vi.fn() })
    return {
      reviewComments: built.find((tool) => tool.name === 'pr_review_comments')!,
      checks: built.find((tool) => tool.name === 'pr_checks')!,
    }
  }

  it('groups inline comments into their threads and leaves resolved ones out by default', async () => {
    await testDb.db.insert(reviewThreads).values([
      { userId: USER, repoId: 1, number: 7, threadId: 't1', id: 'c1', path: 'src/a.ts', line: 10, side: 'RIGHT', resolved: false, author: 'reviewer', body: 'rename this', createdAt: 2 },
      { userId: USER, repoId: 1, number: 7, threadId: 't1', id: 'c2', path: 'src/a.ts', line: 10, side: 'RIGHT', resolved: false, author: 'author', body: 'done', createdAt: 3 },
      { userId: USER, repoId: 1, number: 7, threadId: 't2', id: 'c3', path: 'src/b.ts', line: 4, side: 'RIGHT', resolved: true, author: 'reviewer', body: 'settled', createdAt: 1 },
    ])
    await testDb.db.insert(reviews).values({ userId: USER, repoId: 1, number: 7, id: 'r1', author: 'reviewer', state: 'CHANGES_REQUESTED', body: 'one thing', submittedAt: 4 })
    await testDb.db.insert(comments).values({ userId: USER, repoId: 1, number: 7, id: 'g1', author: 'bot', body: 'deployed', createdAt: 5 })

    const open = await tools().reviewComments.handler({}, { taskId: 'task-1', userLogin: USER }) as {
      number: number
      reviews: { state: string | null }[]
      threads: { threadId: string; comments: { body: string | null }[] }[]
      comments: { body: string | null }[]
      omitted: number
    }
    expect(open.number).toBe(7)
    expect(open.reviews).toEqual([{ author: 'reviewer', state: 'CHANGES_REQUESTED', body: 'one thing', submittedAt: 4 }])
    expect(open.threads).toHaveLength(1)
    expect(open.threads[0]!.threadId).toBe('t1')
    expect(open.threads[0]!.comments.map((comment) => comment.body)).toEqual(['rename this', 'done'])
    expect(open.comments.map((comment) => comment.body)).toEqual(['deployed'])
    expect(open.omitted).toBe(0)

    const all = await tools().reviewComments.handler({ includeResolved: true }, { taskId: 'task-1', userLogin: USER }) as { threads: unknown[] }
    expect(all.threads).toHaveLength(2)
  })

  it('calls out the failing checks and treats a check with no status as still running', async () => {
    await testDb.db.insert(checks).values([
      { userId: USER, repoId: 1, number: 7, name: 'lint', status: 'success', url: null, runId: null },
      { userId: USER, repoId: 1, number: 7, name: 'test', status: 'failure', url: 'https://example.com/run', runId: 42 },
      { userId: USER, repoId: 1, number: 7, name: 'deploy', status: null, url: null, runId: null },
    ])

    const result = await tools().checks.handler({}, { taskId: 'task-1', userLogin: USER }) as { number: number; checks: { name: string }[]; failing: string[] }
    expect(result.number).toBe(7)
    expect(result.checks.map((check) => check.name)).toEqual(['deploy', 'lint', 'test'])
    expect(result.failing).toEqual(['test'])
  })

  // An unmirrored PR is not a PR with no feedback and not a green one, and both tools have to say so.
  it('distinguishes an unmirrored pull request from an empty one', async () => {
    const core = {
      tasks: { load: async () => task },
      projects: { byId: async () => project },
    } as unknown as Pick<CoreServices, 'projects' | 'tasks'>
    const built = githubAgentTools(testDb.db, core, { withConnection: vi.fn() })
    const ctx = { taskId: 'task-1', userLogin: USER }

    expect(await built.find((tool) => tool.name === 'pr_review_comments')!.handler({}, ctx)).toMatchObject({ status: 'no-mirrored-pr' })
    expect(await built.find((tool) => tool.name === 'pr_checks')!.handler({}, ctx)).toMatchObject({ status: 'no-mirrored-checks' })
  })
})
