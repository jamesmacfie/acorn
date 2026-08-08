import { Hono } from 'hono'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../../main/bindings'
import type { AppEnv } from '../middleware/auth'
import { requireUser } from '../middleware/requireUser'
import { schema } from '../db'
import { makeTestDb, testSecretEnv, type TestDb } from '../../testkit/db'
import { setTaskSessionsBridge, worktree, type TaskSessionsBridge } from './worktree'

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

  it('inspects MCP config only from known candidate files', async () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { probe: { command: 'x', env: { TOKEN: 'super-secret' } } } }))
    const app = authed()
    const found = (await (await app.fetch(req('/core/tasks/task1/mcp'), env())).json()) as { file: string; servers: unknown[] }[]
    const own = found.find((entry) => entry.file === join(dir, '.mcp.json'))
    expect(own?.servers).toHaveLength(1)
    // Masked in core, so a raw value never reaches the renderer.
    expect(JSON.stringify(own)).not.toContain('super-secret')
  })

  it('refuses to overwrite an existing .mcp.json starter', async () => {
    const app = authed()
    expect(await (await app.fetch(req('/core/tasks/task1/mcp/starter', 'POST'), env())).json()).toEqual({ ok: true })
    expect(await (await app.fetch(req('/core/tasks/task1/mcp/starter', 'POST'), env())).json()).toMatchObject({ ok: false })
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
})
