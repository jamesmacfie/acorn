import { Hono } from 'hono'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../../main/bindings'
import type { AppEnv } from '../middleware/auth'
import { requireUser } from '../middleware/requireUser'
import { schema } from '../db'
import { makeTestDb, testSecretEnv, type TestDb } from './testDb'
import { setTaskSessionsBridge, worktree, type TaskSessionsBridge } from './worktree'

// The transport contract for the eleven routes that moved out of the terminal plugin in Phase 2's
// scope-shed (docs/vNext/plan.md § Phase 2). These are core's now: routing, body validation, and —
// for archive alone — clean degradation when the PTY slot is unfilled, which is the behaviour dev:node
// has always had.

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
  await testDb.db.insert(schema.tasks).values({
    id: 'task1',
    repoOwner: 'acme',
    repoName: 'widget',
    branch: 'main',
    title: 'a task',
    status: 'active',
    origin: 'local',
    worktreePath: dir,
    createdAt: now,
    updatedAt: now,
  })
  // taskRoot() resolves a task's root THROUGH the repo→checkout mapping (main/taskWorktree.ts), not
  // from tasks.worktreePath alone — so every task-scoped route below needs this row to exist.
  await testDb.db.insert(schema.repoPaths).values({ owner: 'acme', repo: 'widget', path: dir, createdAt: now, updatedAt: now })
})

afterEach(() => {
  setTaskSessionsBridge(null)
  testDb.cleanup()
  rmSync(dir, { recursive: true, force: true })
})

describe('worktree routes', () => {
  it('serves repo-path mapping and rejects a get with no owner/repo', async () => {
    const app = authed()
    expect((await app.fetch(req('/core/repos/path'), env())).status).toBe(400)
    expect(await (await app.fetch(req('/core/repos/path?owner=nobody&repo=nothing'), env())).json()).toBeNull()

    const mapped = (await (await app.fetch(req('/core/repos/path?owner=acme&repo=widget'), env())).json()) as { path: string }
    expect(mapped.path).toBe(dir)
  })

  it('persists the executable repo config that config-trust gates', async () => {
    const app = authed()
    const res = await app.fetch(
      req('/core/repos/path/config', 'PUT', { owner: 'acme', repo: 'widget', patch: { setupScript: 'echo hi', previewMode: 'port', previewValue: '3000' } }),
      env(),
    )
    expect(res.status).toBe(200)
    const [row] = await testDb.db.select().from(schema.repoPaths)
    expect(row.setupScript).toBe('echo hi')
    expect(row.previewValue).toBe('3000')
  })

  it('400s a malformed repo-config patch', async () => {
    const app = authed()
    // branchPrefix is capped at 60 chars, and dbSchemaMode is a closed set — the body contract is the
    // reason this route belongs beside config-trust rather than behind a passthrough bridge.
    expect((await app.fetch(req('/core/repos/path/config', 'PUT', { owner: 'a', repo: 'b', patch: { branchPrefix: 'x'.repeat(61) } }), env())).status).toBe(400)
    expect((await app.fetch(req('/core/repos/path/config', 'PUT', { owner: 'a', repo: 'b', patch: { dbSchemaMode: 'nope' } }), env())).status).toBe(400)
    expect((await app.fetch(req('/core/repos/path/run-targets', 'PUT', { owner: 'a', repo: 'b' }), env())).status).toBe(400)
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
    // The reason this route moved through the process broker: it used to run with no env option at
    // all, so a repo-configured script saw SESSION_ENC_KEY and INTERNAL_TOKEN.
    const app = authed()
    const res = await app.fetch(req('/core/tasks/task1/preview-url', 'POST', { script: 'echo "[${SESSION_ENC_KEY:-absent}]"' }), env())
    expect(await res.json()).toEqual({ ok: true, url: '[absent]' })
  })

  it('use-checkout adopts the mapped checkout and wraps a null result', async () => {
    const app = authed()
    // Adopts the mapped checkout and its current branch; the result is wrapped rather than bare, so a
    // null (no mapping) is not a 404 the client has to special-case.
    const adopted = (await (await app.fetch(req('/core/tasks/task1/use-checkout', 'POST'), env())).json()) as { result: { worktreePath: string } | null }
    expect(adopted.result?.worktreePath).toBe(dir)
    const [task] = await testDb.db.select().from(schema.tasks)
    expect(task.worktreePath).toBe(dir)
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
