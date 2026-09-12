import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintInternalToken } from './auth/internalTokens'
import { schema } from './db'
import { createApp } from './index'
import { makeTestDb, testSecretEnv, type TestDb } from '../testkit/db'
import type { Env } from './bindings'

// What an agent's own credential can reach, asserted end to end through the real mount table rather
// than through a hand-built router. Every route below was reachable by a task-scoped internal token
// before phase 1 of the review program, and each one is here because it was: the preference write that
// let an agent raise its own tool ceiling, the project scripts this node executes later, and workspace
// deletion.
//
// mountCoverage.test.ts is the structural companion — it fails when an ungated core mount appears at
// all. This one is the behavioural check on the specific routes the review named, so a refactor that
// keeps a gate mounted but stops it applying still fails something.
//
// Core routes only. The plugin half of the same review — GitHub's OAuth device flow, notes' workspace
// routes — is asserted in each plugin's own suite, because a plugin router reaches this mount table
// only once the app composes it and node-core does not know those plugins exist.

const ENC_KEY = '0'.repeat(64)
const KEY = 'internal-signing-key'

let testDb: TestDb

const env = () => ({
  DB: testDb.db,
  INTERNAL_TOKEN: KEY,
  // A paired device, so the renderer's half of each case below travels the real bearer path rather than
  // a seeded principal. Seeding one outside createApp() does not work: the app's own authMiddleware
  // runs over /v2/* and resolves the principal again, so a seeded value is replaced by null and every
  // "the renderer is unaffected" assertion passes on a 401 it never meant to allow.
  DEVICES: { authenticate: async () => ({ deviceId: 'device-1' }) },
  ACTIVE_IDENTITY: { get: () => 'james', set: vi.fn(), clear: vi.fn() },
  ...testSecretEnv(ENC_KEY),
}) as unknown as Env

const asTask = (taskId: string) => ({ 'x-acorn-internal': mintInternalToken(KEY, { scope: 'task', taskId }) })

const AS_DEVICE = { authorization: 'Bearer paired-device-token' }

const call = (app: Hono<never>, method: string, path: string, headers: Record<string, string>) =>
  app.fetch(
    new Request(`https://127.0.0.1${path}`, {
      method,
      headers: { ...headers, ...(method === 'GET' || method === 'DELETE' ? {} : { 'content-type': 'application/json' }) },
      ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
    }),
    env(),
  )

describe("what a task-scoped agent token can reach", () => {
  const app = createApp() as unknown as Hono<never>
  const headers = asTask('task-1')

  beforeEach(async () => {
    testDb = makeTestDb()
    const now = Date.now()
    await testDb.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await testDb.db.insert(schema.projects).values({
      id: 'project-1', name: 'widget', path: '/tmp/widget', workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    for (const id of ['task-1', 'task-2']) {
      await testDb.db.insert(schema.tasks).values({
        id, projectId: 'project-1', branch: id, title: id, status: 'active', origin: 'local',
        worktreePath: `/tmp/${id}`, createdAt: now, updatedAt: now,
      })
    }
  })

  afterEach(() => testDb.cleanup())

  it.each([
    // The self-unlock. `agentTools.perms` is a preference key, so this write was the agent turning its
    // own execute tier back on.
    ['PUT', '/v2/core/prefs'],
    // Project writes. Each of these lands `setup_script`, `dev_script`, `teardown_script`,
    // `db_url_script` or `run_targets` — commands this node runs on the next task — and none of them is
    // task-addressed, so the write went against any project id, not the token's own.
    ['POST', '/v2/core/projects'],
    ['PATCH', '/v2/core/projects/other-project'],
    ['PUT', '/v2/core/projects/other-project/config'],
    ['PUT', '/v2/core/projects/other-project/run-targets'],
    ['DELETE', '/v2/core/projects/other-project'],
    // Workspaces: destructive rather than code execution, and equally not task-addressed.
    ['POST', '/v2/core/workspaces'],
    ['DELETE', '/v2/core/workspaces/other-workspace'],
  ])('answers 403 to %s %s', async (method, path) => {
    expect((await call(app, method, path, headers)).status).toBe(403)
  })

  // Reads are gated too, not only writes: the config GET hands back the same scripts, and the project
  // list is the layout of every codebase on the machine.
  it.each([
    ['GET', '/v2/core/prefs'],
    ['GET', '/v2/core/projects'],
    ['GET', '/v2/core/projects/other-project/config'],
    ['GET', '/v2/core/workspaces'],
  ])('answers 403 to %s %s', async (method, path) => {
    expect((await call(app, method, path, headers)).status).toBe(403)
  })

  // Two lists answer 200 and are narrowed instead, because a caller with a legitimate reason to ask
  // about its own task should get an answer rather than a refusal. What it must not get is every other
  // task's title, branch and absolute worktree path.
  it('narrows the task list to the caller\'s own task instead of refusing it', async () => {
    const response = await call(app, 'GET', '/v2/core/tasks', headers)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { id: string }[]).map((task) => task.id)).toEqual(['task-1'])
    // Both rows are really there, so the narrow answer above is the filter and not an empty fixture.
    const asDevice = await call(app, 'GET', '/v2/core/tasks', AS_DEVICE)
    expect(asDevice.status).toBe(200)
    expect(((await asDevice.json()) as { id: string }[]).map((task) => task.id).sort()).toEqual(['task-1', 'task-2'])
  })

  // Not 401: the caller authenticated fine, it just is not the owner at a keyboard. A 401 would invite
  // a retry loop instead of stopping one (§ Transport and auth).
  it('says the caller is authenticated but not entitled', async () => {
    const response = await call(app, 'PUT', '/v2/core/prefs', headers)
    expect(await response.json()).toMatchObject({ error: { code: 'interactive_user_required' } })
  })

  // The gate is confinement, not a blanket refusal: the same token still reaches its own task, or the
  // agent surfaces it exists to serve would all be dead.
  it('still reaches its own task and is refused another', async () => {
    expect((await call(app, 'GET', '/v2/core/tasks/task-1/context', headers)).status).not.toBe(403)
    expect((await call(app, 'GET', '/v2/core/tasks/task-2/context', headers)).status).toBe(404)
  })

  // The renderer is unaffected by all of the above, which is the reason a device gate is the right
  // instrument here: every one of these surfaces is a settings form.
  it('leaves a device principal alone', async () => {
    for (const path of ['/v2/core/prefs', '/v2/core/projects', '/v2/core/workspaces']) {
      expect((await call(app, 'GET', path, AS_DEVICE)).status, path).toBe(200)
    }
  })
})
