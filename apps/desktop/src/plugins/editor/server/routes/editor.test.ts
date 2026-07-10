import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { editorBridge } from '../../main/editor'
import { schema } from '../../../../core/server/db'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { requireUser } from '../../../../core/server/middleware/requireUser'
import { makeTestDb, type TestDb } from '../../../../core/server/routes/testDb'
import { editor, setEditorBridge } from './editor'

// Editor is a write/read boundary confined to the worktree, so its route test runs against a REAL
// worktree (Phase 3 §3 / security §7): path traversal, symlink escape, missing worktree. The path
// confinement lives in taskWorktree.resolveInRoot; exercising it end-to-end is the point.

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
  return app.route('/api/tasks', editor)
}

describe('editor routes over a real worktree', () => {
  let t: TestDb
  let work: string
  let outside: string

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'acorn-editor-work-'))
    outside = mkdtempSync(join(tmpdir(), 'acorn-editor-outside-'))
    execFileSync('git', ['init', '-q'], { cwd: work })
    writeFileSync(join(work, 'hello.txt'), 'hi there', 'utf8')
    mkdirSync(join(work, 'sub'))
    writeFileSync(join(work, 'sub', 'a.ts'), 'export const a = 1\n', 'utf8')
    writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET', 'utf8')
    symlinkSync(outside, join(work, 'escape')) // a symlink inside the worktree pointing out of it
  })
  afterAll(() => {
    rmSync(work, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  beforeEach(async () => {
    t = makeTestDb()
    setEditorBridge(editorBridge(t.db))
    const now = Date.now()
    await t.db.insert(schema.repoPaths).values({ owner: 'acme', repo: 'widget', path: work, createdAt: now, updatedAt: now })
    // worktreePath = the checkout itself: taskRoot returns it directly (no worktree creation).
    await t.db.insert(schema.tasks).values({
      id: 'task1', title: 'T', origin: 'local', repoOwner: 'acme', repoName: 'widget', branch: 'main',
      worktreePath: work, pullNumber: null, status: 'active', sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    })
    // task2: repo has no mapped checkout → no worktree.
    await t.db.insert(schema.tasks).values({
      id: 'task2', title: 'U', origin: 'local', repoOwner: 'other', repoName: 'none', branch: 'main',
      worktreePath: null, pullNumber: null, status: 'active', sort: 1, createdAt: now, updatedAt: now, archivedAt: null,
    })
  })
  afterEach(() => {
    setEditorBridge(null)
    t.cleanup()
  })

  it('reads, lists, files, and roots a real worktree', async () => {
    const app = authed()
    expect(await (await app.fetch(req('/api/tasks/task1/editor/read?path=hello.txt'), {} as Env)).json()).toEqual({ text: 'hi there' })
    expect(await (await app.fetch(req('/api/tasks/task1/editor/root'), {} as Env)).json()).toEqual({ root: work })
    const list = (await (await app.fetch(req('/api/tasks/task1/editor/list?path='), {} as Env)).json()) as { name: string; dir: boolean }[]
    expect(list.find((e) => e.name === 'sub')).toEqual({ name: 'sub', dir: true })
    expect(list.find((e) => e.name === 'hello.txt')).toEqual({ name: 'hello.txt', dir: false })
    const files = (await (await app.fetch(req('/api/tasks/task1/editor/files'), {} as Env)).json()) as string[]
    expect(files).toContain('hello.txt')
    expect(files).toContain('sub/a.ts')
  })

  it('writes within the worktree', async () => {
    const res = await authed().fetch(req('/api/tasks/task1/editor/file', 'PUT', { path: 'sub/a.ts', content: 'export const a = 2\n' }), {} as Env)
    expect(await res.json()).toEqual({ ok: true })
    expect(readFileSync(join(work, 'sub', 'a.ts'), 'utf8')).toBe('export const a = 2\n')
  })

  it('rejects path traversal on read (403) and write ({ok:false}) — outside file untouched', async () => {
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/editor/read?path=../../../etc/passwd'), {} as Env)).status).toBe(403)
    const w = await app.fetch(req('/api/tasks/task1/editor/file', 'PUT', { path: '../escape-write.txt', content: 'x' }), {} as Env)
    expect(await w.json()).toMatchObject({ ok: false })
  })

  it('rejects a symlink that escapes the worktree (403), never leaking the outside file', async () => {
    const res = await authed().fetch(req('/api/tasks/task1/editor/read?path=escape/secret.txt'), {} as Env)
    expect(res.status).toBe(403)
    const w = await authed().fetch(req('/api/tasks/task1/editor/file', 'PUT', { path: 'escape/secret.txt', content: 'pwned' }), {} as Env)
    expect(await w.json()).toMatchObject({ ok: false })
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('TOP SECRET') // unchanged
  })

  it('404s a read when the task has no mapped worktree', async () => {
    expect((await authed().fetch(req('/api/tasks/task2/editor/read?path=a.ts'), {} as Env)).status).toBe(404)
  })

  it('400s a malformed write body; 401s without a principal', async () => {
    expect((await authed().fetch(req('/api/tasks/task1/editor/file', 'PUT', { path: '' }), {} as Env)).status).toBe(400)
    expect((await authed().fetch(req('/api/tasks/task1/editor/read'), {} as Env)).status).toBe(400)
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', editor)
    expect((await gated.fetch(req('/api/tasks/task1/editor/root'), {} as Env)).status).toBe(401)
  })
})
