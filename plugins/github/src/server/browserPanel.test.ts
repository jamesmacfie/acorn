import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type AppEnv, type Env, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { browserPanelView, type BrowserPanelView } from '@acorn/protocol/plugin/handoffs.ts'
import type { PullDetail } from '../shared/api'
import { githubPlugin } from '../node/index'
import { syncState } from '../node/schema'
import { prPaneContribution } from '../client/pullDetail/paneContribution'
import { fakeGithub, makeFakePull } from './routes/mirror/fakeGithub.helper'
import { resolveRepoForUser } from './routes/mirror/repoMirror'
import { browserPanel, pullPanelView } from './browserPanel'

vi.mock('./routes/mirror/repoMirror', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./routes/mirror/repoMirror')>()
  return { ...actual, resolveRepoForUser: vi.fn() }
})
// The credential lives in core's integrations table. These tests hand one over, or none.
const credential = vi.hoisted(() => ({ token: 'token' }))
vi.mock('./githubToken', () => ({ githubToken: async () => credential.token }))

const detail = (over: Partial<NonNullable<PullDetail['pull']>> = {}, rest: Partial<PullDetail> = {}): PullDetail => ({
  pull: {
    number: 482,
    title: 'Fix the flaky test',
    state: 'open',
    draft: false,
    author: 'ada',
    headRef: 'fix-flaky',
    baseRef: 'main',
    updatedAt: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    autoMergeEnabled: false,
    body: null,
    headSha: 'abc',
    ...over,
  },
  labels: [],
  reviews: [],
  requestedReviewers: [],
  comments: [],
  commits: [],
  checks: [],
  threads: [],
  ...rest,
})
const check = (name: string, status: string | null, url: string | null = null) => ({ name, status, url, runId: null })
const review = (author: string, state: string, submittedAt: number) => ({
  id: `${author}-${submittedAt}`,
  author,
  state,
  body: null,
  submittedAt,
})
// Every view goes through the schema the extension's host applies.
const view = (pull: PullDetail) => browserPanelView.parse(pullPanelView('acme', 'web', pull))
const status = (panel: BrowserPanelView) => panel.blocks.find((block) => block.kind === 'status')!
const rows = (panel: BrowserPanelView, title: string) =>
  panel.blocks.flatMap((block) => (block.kind === 'rows' && block.title === title ? block.rows : []))

describe('the pull request panel view', () => {
  it('shows an open pull request ready to merge, with its reviews and links', () => {
    const panel = view(
      detail(
        { autoMergeEnabled: true },
        {
          checks: [check('lint', 'SUCCESS')],
          reviews: [review('bo', 'CHANGES_REQUESTED', 1), review('bo', 'APPROVED', 2), review('cy', 'PENDING', 3)],
          requestedReviewers: ['bo', 'di'],
          threads: [{ threadId: 't', path: null, line: null, side: null, resolved: false, comments: [] }],
        },
      ),
    )
    expect(panel.blocks.map((block) => block.kind)).toEqual(['status', 'rows', 'rows', 'links'])
    expect(status(panel)).toEqual({
      kind: 'status',
      label: 'Pull request #482',
      state: 'Open',
      severity: 'info',
      detail: 'Fix the flaky test\nfix-flaky → main\nReady to merge\n1 unresolved review thread\nAuto-merge is on',
    })
    expect(rows(panel, 'Reviews')).toEqual([
      { label: 'bo', state: 'approved', severity: 'info' },
      { label: 'di', state: 'requested', severity: 'pending' },
    ])
    expect(panel.blocks.at(-1)).toEqual({
      kind: 'links',
      title: 'Links',
      links: [
        { label: 'Pull request', url: 'https://github.com/acme/web/pull/482' },
        { label: 'Checks', url: 'https://github.com/acme/web/pull/482/checks' },
      ],
    })
  })

  it('shows a draft, and leaves out empty blocks', () => {
    const panel = view(detail({ draft: true, mergeStateStatus: 'DRAFT' }))
    expect(status(panel)).toMatchObject({
      state: 'Draft',
      severity: 'info',
      detail: 'Fix the flaky test\nfix-flaky → main',
    })
    expect(panel.blocks.map((block) => block.kind)).toEqual(['status', 'links'])
  })

  it('shows merged and closed pull requests as info, whatever their checks say', () => {
    const failing = { checks: [check('test', 'FAILURE')] }
    expect(status(view(detail({ state: 'merged' }, failing)))).toMatchObject({ state: 'Merged', severity: 'info' })
    expect(status(view(detail({ state: 'closed' }, failing)))).toMatchObject({ state: 'Closed', severity: 'info' })
  })

  it('marks a conflicting pull request as danger', () => {
    const panel = view(detail({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }))
    expect(status(panel)).toMatchObject({ severity: 'danger' })
    expect(status(panel).kind === 'status' && status(panel).detail).toContain('Has conflicts with the base branch')
  })

  it('puts failed checks first, then running ones, and links each failure', () => {
    const panel = view(
      detail(
        { mergeStateStatus: 'UNSTABLE' },
        {
          checks: [
            check('lint', 'SUCCESS'),
            check('build', 'IN_PROGRESS'),
            check('test', 'FAILURE', 'https://github.com/acme/web/actions/runs/1'),
            check('deploy', null),
            check('e2e', 'TIMED_OUT'),
          ],
          reviews: [review('bo', 'CHANGES_REQUESTED', 1), review('bo', 'COMMENTED', 2)],
        },
      ),
    )
    expect(status(panel)).toMatchObject({ severity: 'danger' })
    expect(rows(panel, 'Checks')).toEqual([
      { label: 'test', state: 'failure', severity: 'danger' },
      { label: 'e2e', state: 'timed out', severity: 'danger' },
      { label: 'build', state: 'in progress', severity: 'pending' },
      { label: 'deploy', state: 'pending', severity: 'pending' },
      { label: 'lint', state: 'success', severity: 'info' },
    ])
    // A comment after a change request leaves the change request standing.
    expect(rows(panel, 'Reviews')).toEqual([{ label: 'bo', state: 'changes requested', severity: 'warn' }])
    expect(panel.blocks.at(-1)).toMatchObject({
      links: [
        { label: 'Pull request' },
        { label: 'Checks' },
        { label: 'test', url: 'https://github.com/acme/web/actions/runs/1' },
      ],
    })
  })

  it('is pending while a check runs, and warns when a reviewer asked for changes', () => {
    expect(status(view(detail({}, { checks: [check('build', 'QUEUED')] })))).toMatchObject({ severity: 'pending' })
    expect(status(view(detail({}, { reviews: [review('bo', 'CHANGES_REQUESTED', 1)] })))).toMatchObject({
      severity: 'warn',
    })
  })

  it('cuts checks to 64 rows, dropping passing ones first', () => {
    const many = Array.from({ length: 70 }, (_, index) => check(`pass-${index}`, 'SUCCESS'))
    const checks = rows(view(detail({}, { checks: [...many, check('test', 'FAILURE')] })), 'Checks')
    expect(checks).toHaveLength(64)
    expect(checks[0]).toMatchObject({ label: 'test' })
  })
})

it("declares the panel on the client's pull request pane", () => {
  expect(githubPlugin().browserPanel?.pane).toBe(prPaneContribution.id)
})

describe('the pull request panel route', () => {
  const tasks: Record<string, { projectId: string; pullNumber: number | null }> = {
    'with-pull': { projectId: 'p1', pullNumber: 7 },
    'no-pull': { projectId: 'p1', pullNumber: null },
    'no-repo': { projectId: 'p2', pullNumber: 7 },
  }
  const core = {
    tasks: { load: async (id: string) => (tasks[id] ? { id, ...tasks[id] } : null) },
    projects: { byId: async (id: string) => ({ id, github: id === 'p1' ? { owner: 'acme', name: 'web' } : null }) },
  } as never
  let plugin: TestPluginDb
  let app: Hono<AppEnv>
  let onStatus: () => void
  const read = (taskId: string) => app.fetch(new Request(`http://acorn.test/panel?taskId=${taskId}`), {} as Env)

  beforeEach(() => {
    plugin = makeTestPluginDb('github')
    credential.token = 'token'
    onStatus = () => {}
    app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    app.route(
      '/panel',
      browserPanel(
        plugin.db,
        core,
        () => {},
        () => onStatus(),
      ),
    )
    vi.mocked(resolveRepoForUser).mockResolvedValue({ ok: true, value: { repoId: 19847 } })
  })
  afterEach(() => {
    plugin.cleanup()
    vi.unstubAllGlobals()
  })

  it('answers 404 for a task with no pull request or no GitHub repository', async () => {
    for (const taskId of ['missing', 'no-pull', 'no-repo']) expect((await read(taskId)).status).toBe(404)
  })

  it('says how to connect GitHub when it is not connected', async () => {
    credential.token = ''
    const panel = browserPanelView.parse(await (await read('with-pull')).json())
    expect(panel.blocks).toEqual([expect.objectContaining({ state: "GitHub isn't connected", severity: 'warn' })])
  })

  it('reads itself once more after a background refresh, and then stops', async () => {
    const pull = makeFakePull({ checks: 1 })
    Object.assign(pull.checks[0]!, { status: 'IN_PROGRESS', conclusion: null })
    const fake = fakeGithub(pull)
    vi.stubGlobal('fetch', fake.fetch)
    // The first read waits for GitHub.
    expect(rows(browserPanelView.parse(await (await read('with-pull')).json()), 'Checks')).toEqual([
      { label: 'check-0', state: 'in progress', severity: 'pending' },
    ])

    // The check finishes on GitHub, and the mirror goes stale.
    Object.assign(pull.checks[0]!, { status: 'COMPLETED', conclusion: 'SUCCESS' })
    await plugin.db.update(syncState).set({ fetchedAt: 0 }).where(eq(syncState.userId, 'james'))
    const graphqlReads = () => fake.requests.filter((request) => request.kind === 'graphql-first').length
    // What one refresh asks GitHub, from the cold read.
    const oneRefresh = graphqlReads()
    // The sidebar reads an open panel again on `term:status`, the way the extension does.
    const rereads: Promise<Response>[] = []
    onStatus = () => void rereads.push(Promise.resolve(read('with-pull')))

    expect((await read('with-pull')).status).toBe(200)
    await vi.waitFor(() => expect(rereads.length).toBeGreaterThan(0))
    const reread = browserPanelView.parse(await (await rereads[0]!).json())
    await new Promise((settle) => setTimeout(settle, 50))

    expect(rows(reread, 'Checks')).toEqual([{ label: 'check-0', state: 'success', severity: 'info' }])
    expect(graphqlReads()).toBe(oneRefresh * 2)
    expect(rereads).toHaveLength(1)
  })
})
