import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredConnection } from '@acorn/plugin-api/node'
import { createTaskService, makeTestDb, schema, type TestDb } from '@acorn/plugin-api/testkit'
import { gh } from './githubApi'
import { startPullDiscovery } from './pullDiscovery'

vi.mock('./githubApi', async (original) => ({ ...await original<typeof import('./githubApi')>(), gh: vi.fn() }))

const pull = (number = 42, branch = 'feat/task') => ({
  number, state: 'open',
  head: { ref: branch, repo: { full_name: 'ACME/widget' } },
  base: { repo: { full_name: 'acme/widget' } },
})
const completed = { channel: 'plugin:agents:turn-changed', taskId: 'task', sessionId: 'session', turnId: 'turn', source: 'interactive', status: 'completed', attempt: 1 }

describe('pull discovery after managed agent turns', () => {
  let db: TestDb
  let discovery: ReturnType<typeof startPullDiscovery>
  let listener: (frame: typeof completed) => void
  let ctx: Parameters<typeof startPullDiscovery>[0]
  let subscriptionDisposed: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.mocked(gh).mockReset()
    db = makeTestDb()
    await db.db.insert(schema.workspaces).values({ id: 'workspace', name: 'Workspace', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 })
    await db.db.insert(schema.projects).values({
      id: 'project', name: 'widget', workspaceId: 'workspace', path: null, sort: 0, hidden: false,
      githubOwner: 'acme', githubName: 'widget', createdAt: 1, updatedAt: 1,
    })
    await db.db.insert(schema.tasks).values({
      id: 'task', title: 'Task', projectId: 'project', branch: 'feat/task', origin: 'local',
      status: 'active', sort: 0, createdAt: 1, updatedAt: 1,
    })
    const tasks = createTaskService(db.db)
    subscriptionDisposed = vi.fn()
    ctx = {
      core: {
        tasks,
        identity: { active: () => 'owner' },
        projects: { byId: async () => ({ github: { owner: 'acme', name: 'widget' } }) },
      },
      providers: {
        withConnection: vi.fn(async <T>(_user: string, _provider: string, visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>) =>
          visit({ id: 'connection' } as StoredConnection, 'token')),
      },
      events: {
        on: (_channel: string, handler: typeof listener) => { listener = handler; return { dispose: subscriptionDisposed } },
      },
      log: { warn: vi.fn() },
    } as unknown as Parameters<typeof startPullDiscovery>[0]
    discovery = startPullDiscovery(ctx)
  })

  afterEach(async () => {
    await discovery.dispose()
    db.cleanup()
  })

  const taskPull = async () => (await db.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task')))[0].pullNumber

  it('adopts a PR without a client PR-list read and leaves agent provenance empty', async () => {
    vi.mocked(gh).mockResolvedValue(Response.json([pull()]))
    listener(completed)
    await vi.waitFor(async () => expect(await taskPull()).toBe(42))
    expect(await ctx.core.tasks.pulls('task')).toEqual([])
    const [token, path] = vi.mocked(gh).mock.calls[0]
    expect(token).toBe('token')
    const url = new URL(path, 'https://api.github.com')
    expect(url.pathname).toBe('/repos/acme/widget/pulls')
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: 'open', head: 'acme:feat/task', per_page: '2' })
  })

  it.each([
    { branch: null, pullNumber: null },
    { branch: 'feat/task', pullNumber: 99 },
  ])('skips unfinished turns and ineligible tasks: %j', async (patch) => {
    listener({ ...completed, status: 'active' })
    await db.db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, 'task'))
    listener(completed)
    await discovery.dispose()
    expect(gh).not.toHaveBeenCalled()
    expect(await taskPull()).toBe(patch.pullNumber)
  })

  it.each([
    ['empty', []],
    ['ambiguous', [pull(), pull(43)]],
    ['fork head', [{ ...pull(), head: { ref: 'feat/task', repo: { full_name: 'someone/widget' } } }]],
    ['other repository', [{ ...pull(), base: { repo: { full_name: 'acme/other' } } }]],
    ['other branch', [pull(42, 'other')]],
    ['closed', [{ ...pull(), state: 'closed' }]],
  ])('leaves the task unlinked for %s results', async (_label, pulls) => {
    vi.mocked(gh).mockResolvedValue(Response.json(pulls))
    const adopt = vi.spyOn(ctx.core.tasks, 'adoptPullNumbers')
    listener(completed)
    await vi.waitFor(() => expect(ctx.providers.withConnection).toHaveResolvedTimes(1))
    expect(adopt).not.toHaveBeenCalled()
    expect(await taskPull()).toBeNull()
  })

  it('does not overwrite a PR attached or a branch changed while GitHub answers', async () => {
    let answer!: (response: Response) => void
    vi.mocked(gh).mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    listener(completed)
    await vi.waitFor(() => expect(gh).toHaveBeenCalledOnce())
    await db.db.update(schema.tasks).set({ pullNumber: 99 }).where(eq(schema.tasks.id, 'task'))
    answer(Response.json([pull()]))
    await vi.waitFor(async () => expect(await taskPull()).toBe(99))
    // Wait for the first lookup before exercising a second completion with another branch.
    await vi.waitFor(() => expect(ctx.providers.withConnection).toHaveResolvedTimes(1))
    await db.db.update(schema.tasks).set({ pullNumber: null }).where(eq(schema.tasks.id, 'task'))
    listener({ ...completed, turnId: 'second-turn' })
    await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(2))
    await db.db.update(schema.tasks).set({ branch: 'other' }).where(eq(schema.tasks.id, 'task'))
    answer(Response.json([pull()]))
    await vi.waitFor(() => expect(ctx.providers.withConnection).toHaveResolvedTimes(2))
    expect(await taskPull()).toBeNull()
  })

  it('logs a provider failure and retries on the next completed turn', async () => {
    vi.mocked(gh).mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(Response.json([pull()]))
    listener(completed)
    await vi.waitFor(() => expect(ctx.log.warn).toHaveBeenCalledOnce())
    expect(await taskPull()).toBeNull()
    listener({ ...completed, turnId: 'retry-turn' })
    await vi.waitFor(async () => expect(await taskPull()).toBe(42))
  })

  it('drains a pending lookup at shutdown without adopting its result', async () => {
    let answer!: (response: Response) => void
    vi.mocked(gh).mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    listener(completed)
    await vi.waitFor(() => expect(gh).toHaveBeenCalledOnce())
    const stop = discovery.dispose()
    expect(subscriptionDisposed).toHaveBeenCalledOnce()
    answer(Response.json([pull()]))
    await stop
    expect(await taskPull()).toBeNull()
  })
})
