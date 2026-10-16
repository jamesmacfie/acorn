import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../bindings'
import { schema } from '../db'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { createTaskService } from '../core/tasks'
import { declareCodeHost } from '../pluginHost/codeHosts'
import { registerRoute, removePluginRoutes } from '../routes/registry'
import { changeRequestSection, registerContextSection } from './contextSections'
import { buildAgentTools } from './coreTools'

vi.mock('../transport/wsHub', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsBroadcast: () => {},
}))

const ENV = { ACTIVE_IDENTITY: { get: () => 'james' } } as unknown as Env
const now = Date.now()

// What a GitLab plugin's `changeRequest.api` routes answer, from fixed data. Core reaches them with no
// GitHub code in the way (docs/plugins/code-hosts.md § Agent context).
const MERGE_REQUEST = { number: 12, title: 'Fix the importer', body: 'Why', changedFiles: ['src/import.ts'] }
const CHECKS = {
  number: 12,
  checks: [{ name: 'test', status: 'failed', url: 'https://gitlab.test/jobs/1' }],
  failing: ['test'],
  pending: [],
}
const FEEDBACK = { number: 12, reviews: [], threads: [], comments: [], omitted: 0 }
const asked: { method: string; path: string; body?: unknown }[] = []

async function gitlabRoutes(request: Request): Promise<Response> {
  const url = new URL(request.url)
  asked.push({
    method: request.method,
    path: `${url.pathname}${url.search}`,
    ...(request.method === 'POST' ? { body: await request.json() } : {}),
  })
  if (request.method === 'POST') return Response.json({ number: 13 })
  const answers: Record<string, unknown> = {
    '/12': MERGE_REQUEST,
    '/12/checks': CHECKS,
    '/12/feedback': url.searchParams.get('includeResolved') === 'true' ? { ...FEEDBACK, omitted: 1 } : FEEDBACK,
  }
  const answer = answers[url.pathname]
  return answer ? Response.json(answer) : Response.json({ error: { code: 'not_found' } }, { status: 404 })
}

describe('change request tools on a code host other than GitHub', () => {
  let t: TestDb
  let undeclare: () => void
  let section: { dispose(): void }

  beforeEach(async () => {
    t = makeTestDb()
    asked.length = 0
    undeclare = declareCodeHost(
      'gitlab-test',
      {
        label: 'GitLab test',
        hosts: ['gitlab.test'],
        changeRequest: { label: 'merge request', prefix: '!', api: '/v1/p/gitlab-test/change-requests' },
      },
      false,
    )
    registerRoute({ plugin: 'gitlab-test', prefix: '/change-requests', fetch: gitlabRoutes })
    section = registerContextSection('core', changeRequestSection(ENV))
    await t.db
      .insert(schema.workspaces)
      .values({ id: 'w', name: 'W', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'p',
      name: 'api',
      workspaceId: 'w',
      sort: 0,
      hidden: false,
      repoProvider: 'gitlab-test',
      repoHost: 'gitlab.test',
      repoPath: 'group/sub/api',
      createdAt: now,
      updatedAt: now,
    })
    await t.db.insert(schema.tasks).values(
      ['one', 'two'].map((id, sort) => ({
        id,
        title: id,
        origin: 'local',
        projectId: 'p',
        branch: `feat/${id}`,
        status: 'active',
        sort,
        createdAt: now,
        updatedAt: now,
      })),
    )
    await t.db.insert(schema.taskChangeRequests).values({
      taskId: 'one',
      provider: 'gitlab-test',
      repoHost: 'gitlab.test',
      repoPath: 'group/sub/api',
      number: 12,
      role: 'primary',
      provenance: 'task',
      createdAt: now,
    })
  })

  afterEach(() => {
    section.dispose()
    removePluginRoutes('gitlab-test')
    undeclare()
    t.cleanup()
  })

  const call = (name: string, taskId: string, input: unknown = {}, sessionId?: string) =>
    buildAgentTools({ db: t.db, secrets: t.secrets, env: ENV })
      .find((tool) => tool.name === name)!
      .handler(input, { userLogin: 'james', taskId, ...(sessionId ? { sessionId } : {}) })

  it("reads the task's merge request, its files, checks, and feedback from the code host", async () => {
    expect(await call('pr_current', 'one')).toEqual({
      id: 'pr:12',
      kind: 'PR',
      label: '!12 Fix the importer',
      body: 'Why',
      details: ['src/import.ts'],
    })
    expect(await call('pr_changed_files', 'one')).toEqual(['src/import.ts'])
    expect(await call('pr_checks', 'one')).toEqual(CHECKS)
    expect(await call('pr_review_comments', 'one')).toEqual(FEEDBACK)
    expect(await call('pr_review_comments', 'one', { includeResolved: true })).toMatchObject({ omitted: 1 })
    expect(asked.map((request) => request.path)).toContain('/12/feedback?includeResolved=true&taskId=one')
  })

  it('names the section and its lead-in the way the code host does', async () => {
    const context = (await call('task_context', 'one', { include: 'pr' })) as {
      task: { changeRequest: unknown }
      sections: { label: string; compact: string }[]
    }
    expect(context.task.changeRequest).toEqual({ provider: 'gitlab-test', number: 12 })
    expect(context.sections[0]).toMatchObject({ label: 'Merge request' })
    expect(context.sections[0]!.compact).toMatch(/^## PR !12 Fix the importer/)
  })

  it('answers no-pr for a task with no primary change request', async () => {
    for (const name of ['pr_current', 'pr_checks', 'pr_review_comments'])
      expect(await call(name, 'two')).toMatchObject({ status: 'no-pr' })
    expect(asked).toEqual([])
  })

  it('opens one from the task branch and attaches it with the agent session', async () => {
    expect(await call('pr_create', 'two', { title: 'Add it', base: 'main' }, 'session')).toEqual({
      number: 13,
      relationship: 'primary',
    })
    expect(asked).toEqual([
      {
        method: 'POST',
        path: '/',
        body: { title: 'Add it', base: 'main', taskId: 'two', head: 'feat/two' },
      },
    ])
    expect(await createTaskService(t.db).changeRequests('two')).toEqual([
      expect.objectContaining({ provider: 'gitlab-test', number: 13, role: 'primary', sessionId: 'session' }),
    ])
  })
})
