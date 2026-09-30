import { Hono } from 'hono'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../../bindings'
import type { AppEnv } from '../../middleware/auth'
import { requireUser } from '../../middleware/requireUser'
import { schema } from '../../db'
import { makeTestDb, testSecretEnv, type TestDb } from '../../../testkit/db'
import { setTaskSessionsBridge, worktree, type TaskSessionsBridge } from './worktree'
import { loadTask, setWorktreesRoot } from '../../worktrees/taskWorktree'

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

let testDb: TestDb
let dir: string

const env = () => ({ DB: testDb.db, ...testSecretEnv('0'.repeat(64)) }) as unknown as Env

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/core/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  return app.route('/core', worktree)
}

const sessions = (over: Partial<TaskSessionsBridge> = {}): TaskSessionsBridge => ({
  ready: async () => {},
  runningCount: () => 0,
  killRunning: () => {},
  dropTaskSessions: async () => {},
  runTeardown: async () => ({ exitCode: 0, output: '' }),
  ...over,
})

beforeEach(async () => {
  testDb = makeTestDb()
  dir = mkdtempSync(join(tmpdir(), 'acorn-worktree-route-'))
  const now = Date.now()
  await testDb.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await testDb.db.insert(schema.projects).values({
    id: 'project-widget', name: 'widget', path: dir, workspaceId: 'workspace-1', sort: 0, hidden: false,
    vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/acme/widget.git', githubOwner: 'acme', githubName: 'widget', githubRepoId: null,
    createdAt: now, updatedAt: now,
  })
  await testDb.db.insert(schema.tasks).values({
    id: 'task1',
    projectId: 'project-widget',
    branch: 'main',
    title: 'a task',
    status: 'active',
    origin: 'local',
    worktreePath: dir,
    createdAt: now,
    updatedAt: now,
  })
})

afterEach(() => {
  setTaskSessionsBridge(null)
  testDb.cleanup()
  rmSync(dir, { recursive: true, force: true })
})

describe('worktree routes', () => {
  it('still prepares a worktree for a task that skips setup', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' })
    execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' })
    git('config', 'user.email', 'test@acorn.invalid')
    git('config', 'user.name', 'Acorn Test')
    writeFileSync(join(dir, 'README.md'), 'test\n')
    git('add', 'README.md')
    git('commit', '-m', 'Initial commit')
    const worktrees = mkdtempSync(join(tmpdir(), 'acorn-on-created-'))
    setWorktreesRoot(worktrees)
    try {
      await testDb.db.update(schema.projects).set({ setupScript: 'true', setupScriptTrigger: 'created' })
        .where(eq(schema.projects.id, 'project-widget'))
      await testDb.db.update(schema.tasks).set({ branch: 'feature', worktreePath: null, skipSetup: true })
        .where(eq(schema.tasks.id, 'task1'))

      const app = authed()
      const skipped = await app.fetch(req('/core/tasks/task1/on-created', 'POST'), env())
      expect(skipped.status).toBe(200)
      expect((await loadTask(testDb.db, 'task1'))?.worktreePath).toBeTruthy()
    } finally {
      setWorktreesRoot('')
      rmSync(worktrees, { recursive: true, force: true })
    }
  })

  it('captures a preview URL from the last non-empty stdout line', async () => {
    const app = authed()
    const res = await app.fetch(req('/core/tasks/task1/preview-url', 'POST', { script: 'echo noise; echo http://localhost:3000' }), env())
    expect(await res.json()).toEqual({ ok: true, url: 'http://localhost:3000' })
  })

  it('reports a preview script that fails or produces nothing, rather than throwing', async () => {
    const app = authed()
    expect(await (await app.fetch(req('/core/tasks/task1/preview-url', 'POST', { script: 'true' }), env())).json()).toMatchObject({ ok: false })
    expect(await (await app.fetch(req('/core/tasks/task1/preview-url', 'POST', { script: 'exit 3' }), env())).json()).toMatchObject({ ok: false })
    expect(await (await app.fetch(req('/core/tasks/task1/preview-url', 'POST', { script: '  ' }), env())).json()).toEqual({ ok: false, reason: 'no script configured' })
    expect((await app.fetch(req('/core/tasks/task1/preview-url', 'POST', {}), env())).status).toBe(400)
  })

  it('does not leak the node environment into a captured command', async () => {
    const app = authed()
    const res = await app.fetch(req('/core/tasks/task1/preview-url', 'POST', { script: 'echo "[${SESSION_ENC_KEY:-absent}]"' }), env())
    expect(await res.json()).toEqual({ ok: true, url: '[absent]' })
  })

  it('archive goes through the PTY slot and 503s when it is unfilled', async () => {
    const app = authed()
    // Unfilled: exactly the degraded mode dev:node had when the whole terminal bridge was unset.
    expect((await app.fetch(req('/core/tasks/task1/archive', 'POST', { force: true }), env())).status).toBe(503)

    const seen: string[] = []
    setTaskSessionsBridge(sessions({ runningCount: (taskId) => (seen.push(`count:${taskId}`), 0) }))
    const res = await app.fetch(req('/core/tasks/task1/archive', 'POST', { force: true }), env())
    expect(res.status).toBe(200)
    expect(seen).toEqual(['count:task1'])
  })

  it('401s without a principal', async () => {
    const gated = new Hono<AppEnv>().use('/core/*', requireUser).route('/core', worktree)
    expect((await gated.fetch(req('/core/task-statuses'), env())).status).toBe(401)
  })

  // Filtered rather than gated: a task-scoped caller may ask about its own task, and each row carries
  // another task's id, absolute worktree path and dirty count. The plugin-frame caller is covered by
  // the same filter, since `core.tasks:read` grants this path.
  it('answers a task-confined caller with its own task only', async () => {
    const now = Date.now()
    await testDb.db.insert(schema.tasks).values({
      id: 'task2', projectId: 'project-widget', branch: 'other', title: 'someone else', status: 'active',
      origin: 'local', worktreePath: dir, createdAt: now, updatedAt: now,
    })

    const confined = new Hono<AppEnv>()
      .use('/core/*', async (c, next) => {
        c.set('principal', { kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
        await next()
      })
      .route('/core', worktree)
    const mine = (await (await confined.fetch(req('/core/task-statuses'), env())).json()) as { taskId: string }[]
    expect(mine.map((row) => row.taskId)).toEqual(['task1'])

    // A device sees the whole roster, so the filter is confinement rather than a narrowed answer for
    // everyone.
    const all = (await (await authed().fetch(req('/core/task-statuses'), env())).json()) as { taskId: string }[]
    expect(all.map((row) => row.taskId).sort()).toEqual(['task1', 'task2'])
  })
})
