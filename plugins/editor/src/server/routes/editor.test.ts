import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { editorBridge } from '../../main/editor'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import * as coreFs from '@acorn/node-core/main/core/fs.ts'
import { createTaskService } from '@acorn/node-core/main/core/tasks.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { editor, setEditorBridge } from './editor'
import type { Env } from '@acorn/node-core/main/bindings.ts'

// Editor is a write/read boundary confined to the worktree, so its route test runs against a real
// worktree exercising the filesystem-containment contract end to end: path traversal, symlink
// escape, missing worktree. Confinement lives in taskWorktree.resolveInRoot.

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
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
    setEditorBridge(editorBridge({ tasks: createTaskService(t.db), fs: coreFs }))
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values([
      {
        id: 'project-widget', name: 'widget', path: work, workspaceId: 'workspace-1', sort: 0, hidden: false,
        vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: null,
        createdAt: now, updatedAt: now,
      },
      {
        id: 'project-none', name: 'none', path: null, workspaceId: 'workspace-1', sort: 1, hidden: false,
        vcs: null, defaultBranch: null, remoteUrl: null, githubOwner: 'other', githubName: 'none', githubRepoId: null,
        createdAt: now, updatedAt: now,
      },
    ])
    // worktreePath = the checkout itself: taskRoot returns it directly (no worktree creation).
    await t.db.insert(schema.tasks).values({
      id: 'task1', title: 'T', origin: 'local', projectId: 'project-widget', branch: 'main',
      worktreePath: work, pullNumber: null, status: 'active', sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    })
    // task2: repo has no mapped checkout → no worktree.
    await t.db.insert(schema.tasks).values({
      id: 'task2', title: 'U', origin: 'local', projectId: 'project-none', branch: 'main',
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
