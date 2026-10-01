import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { editorBridge } from '../editor'
import { makeTestDb, schema, type TestDb } from '@acorn/plugin-api/testkit'
import type { AppEnv } from '@acorn/plugin-api/testkit'
import { requireUser } from '@acorn/plugin-api/testkit'
import * as coreFs from '@acorn/plugin-api/testkit'
import { createTaskService } from '@acorn/plugin-api/testkit'
import { editor, setEditorBridge } from './editor'
import type { Env } from '@acorn/plugin-api/testkit'
import { MAX_IMAGE_PREVIEW_BYTES } from '../../contract/imagePreview'

// Editor reads and writes inside the worktree, so this runs against a real one and exercises the
// filesystem-containment contract end to end: path traversal, symlink escape, missing worktree.
// Confinement lives in taskWorktree.resolveInRoot.

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
    writeFileSync(join(work, 'sub', 'photo.webp'), Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0xff]))
    writeFileSync(join(work, 'sub', 'large.png'), '')
    truncateSync(join(work, 'sub', 'large.png'), MAX_IMAGE_PREVIEW_BYTES + 1)
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
    expect(await (await app.fetch(req('/api/tasks/task1/editor/line-markers?path=hello.txt'), {} as Env)).json()).toEqual([])
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

  it('returns image bytes with their type while rejecting unsupported paths and oversized images', async () => {
    const app = authed()
    const res = await app.fetch(req('/api/tasks/task1/editor/image?path=sub%2Fphoto.webp'), {} as Env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0xff]))
    expect((await app.fetch(req('/api/tasks/task1/editor/image?path=hello.txt'), {} as Env)).status).toBe(422)
    expect((await app.fetch(req('/api/tasks/task1/editor/image?path=sub%2Flarge.png'), {} as Env)).status).toBe(422)
  })

  it('confines image reads to the task worktree', async () => {
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/editor/image?path=..%2F..%2Foutside.png'), {} as Env)).status).toBe(403)
    expect((await app.fetch(req('/api/tasks/task1/editor/image?path=escape%2Fsecret.png'), {} as Env)).status).toBe(403)
    expect((await app.fetch(req('/api/tasks/task2/editor/image?path=photo.webp'), {} as Env)).status).toBe(404)
  })

  it('merges optional marker providers and keeps a failed source isolated', async () => {
    setEditorBridge(editorBridge(
      { tasks: createTaskService(t.db), fs: coreFs },
      () => {},
      undefined,
      () => [
        { kind: 'pull-request', read: async () => [{ from: 2, to: 3 }, { from: 3, to: 4 }] },
        { kind: 'pull-request', read: async () => [{ from: 8, to: 8 }] },
        { kind: 'uncommitted', read: async () => { throw new Error('status unavailable') } },
      ],
    ))
    const response = await authed().fetch(req('/api/tasks/task1/editor/line-markers?path=hello.txt'), {} as Env)
    expect(await response.json()).toEqual([
      { kind: 'pull-request', ranges: [{ from: 2, to: 4 }, { from: 8, to: 8 }] },
    ])
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

  it('refuses a dangling link before writing, but allows an ordinary new file', async () => {
    const outsideTarget = join(outside, 'never-created.txt')
    symlinkSync(outsideTarget, join(work, 'dangling.txt'))
    const app = authed()
    const refused = await app.fetch(req('/api/tasks/task1/editor/file', 'PUT', { path: 'dangling.txt', content: 'synthetic content' }), {} as Env)
    expect(await refused.json()).toMatchObject({ ok: false })
    expect(existsSync(outsideTarget)).toBe(false)
    const written = await app.fetch(req('/api/tasks/task1/editor/file', 'PUT', { path: 'sub/new.txt', content: 'ordinary content' }), {} as Env)
    expect(await written.json()).toEqual({ ok: true })
    expect(readFileSync(join(work, 'sub/new.txt'), 'utf8')).toBe('ordinary content')
  })

  it('400s a malformed write body; 401s without a principal', async () => {
    expect((await authed().fetch(req('/api/tasks/task1/editor/file', 'PUT', { path: '' }), {} as Env)).status).toBe(400)
    expect((await authed().fetch(req('/api/tasks/task1/editor/read'), {} as Env)).status).toBe(400)
    expect((await authed().fetch(req('/api/tasks/task1/editor/image'), {} as Env)).status).toBe(400)
    expect((await authed().fetch(req('/api/tasks/task1/editor/line-markers'), {} as Env)).status).toBe(400)
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', editor)
    expect((await gated.fetch(req('/api/tasks/task1/editor/root'), {} as Env)).status).toBe(401)
  })
})
