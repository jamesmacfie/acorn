import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { localGitBridge } from '../../main/localGit'
import type { LocalChange } from '../../shared/terminal'
import { schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { requireUser } from '../middleware/requireUser'
import { onServerError } from '../respond'
import { localGit, setLocalGitBridge } from './localGit'
import { makeTestDb, type TestDb } from './testDb'

// Wiring test over a REAL git worktree (the git parsing itself is covered by main/localDiff.test.ts):
// working-tree status, a stage mutation, plus auth + body validation + bridge-unavailable.

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } })
    await next()
  })
  return app.route('/api/tasks', localGit).onError(onServerError)
}

describe('local-git routes over a real worktree', () => {
  let t: TestDb
  let work: string

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'acorn-localgit-'))
    execFileSync('git', ['init', '-q'], { cwd: work })
    execFileSync('git', ['config', 'user.email', 'test@acorn.dev'], { cwd: work })
    execFileSync('git', ['config', 'user.name', 'Acorn Test'], { cwd: work })
    writeFileSync(join(work, 'new.txt'), 'hello\n', 'utf8')
  })
  afterAll(() => rmSync(work, { recursive: true, force: true }))

  beforeEach(async () => {
    t = makeTestDb()
    setLocalGitBridge(localGitBridge(t.db))
    const now = Date.now()
    await t.db.insert(schema.repoPaths).values({ owner: 'acme', repo: 'widget', path: work, createdAt: now, updatedAt: now })
    await t.db.insert(schema.tasks).values({
      id: 'task1', title: 'T', origin: 'local', repoOwner: 'acme', repoName: 'widget', branch: 'main',
      worktreePath: work, pullNumber: null, status: 'active', sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    })
  })
  afterEach(() => {
    setLocalGitBridge(null)
    t.cleanup()
  })

  it('lists the untracked file and stages it', async () => {
    const app = authed()
    const changes = (await (await app.fetch(req('/api/tasks/task1/local/changes'), {} as Env)).json()) as LocalChange[]
    expect(changes.find((c) => c.path === 'new.txt')?.status).toBe('untracked')

    const staged = await (await app.fetch(req('/api/tasks/task1/local/stage', 'POST', { path: 'new.txt' }), {} as Env)).json()
    expect(staged).toMatchObject({ ok: true })
    const after = (await (await app.fetch(req('/api/tasks/task1/local/changes'), {} as Env)).json()) as LocalChange[]
    expect(after.find((c) => c.path === 'new.txt')?.staged).toBe(true)
  })

  it('400s a stage with no path; 400s a diff with no path query', async () => {
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/local/stage', 'POST', {}), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/diff'), {} as Env)).status).toBe(400)
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', localGit)
    expect((await gated.fetch(req('/api/tasks/task1/local/changes'), {} as Env)).status).toBe(401)
    setLocalGitBridge(null)
    expect((await authed().fetch(req('/api/tasks/task1/local/changes'), {} as Env)).status).toBe(503)
  })
})
