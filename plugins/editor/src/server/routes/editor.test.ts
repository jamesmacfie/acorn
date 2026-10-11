import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { editorBridge, editorFiles, type EditorCoreServices } from '../editor'
import { claimEditorPty } from '../editorPtyOwners'
import { makeTestCoreServices, makeTestDb, schema, type TestDb } from '@acorn/plugin-api/testkit'
import type { AppEnv } from '@acorn/plugin-api/testkit'
import { requireUser } from '@acorn/plugin-api/testkit'
import { confineExistingFile, isContainedPath, isValidRepoIdent, resolveInRoot } from '@acorn/plugin-api/testkit'
import { createTaskService } from '@acorn/plugin-api/testkit'
import { editor, setEditorBridge } from './editor'
import type { Env } from '@acorn/plugin-api/testkit'
import { MAX_IMAGE_PREVIEW_BYTES } from '../../contract/imagePreview'
import { MAX_EDITOR_FILE_READ_BYTES } from '../../contract/files'

const coreFs = { confineExistingFile, isContainedPath, isValidRepoIdent, resolveInRoot }

// Editor reads and writes inside the worktree, so this runs against a real one and exercises the
// filesystem-containment contract end to end: path traversal, symlink escape, missing worktree.
// Confinement is CoreServices `fs.resolveInRoot`.

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
let testProc: EditorCoreServices['proc']

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
  let helperDir: string
  let previousHelperDir: string | undefined

  beforeAll(() => {
    helperDir = mkdtempSync(join(tmpdir(), 'acorn-editor-native-test-'))
    previousHelperDir = process.env.ACORN_EXCLUSIVE_RENAME_DIR
    execFileSync('cc', [
      '-o',
      join(helperDir, 'exclusive-rename'),
      join(import.meta.dirname, '../../../native/exclusive-rename.c'),
    ])
    writeFileSync(
      join(helperDir, 'exclusive-rename.json'),
      JSON.stringify({ available: true, platform: process.platform, arch: process.arch }),
    )
    process.env.ACORN_EXCLUSIVE_RENAME_DIR = helperDir
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
    rmSync(helperDir, { recursive: true, force: true })
    if (previousHelperDir === undefined) delete process.env.ACORN_EXCLUSIVE_RENAME_DIR
    else process.env.ACORN_EXCLUSIVE_RENAME_DIR = previousHelperDir
  })

  beforeEach(async () => {
    t = makeTestDb()
    testProc = makeTestCoreServices(t).proc
    setEditorBridge(editorBridge({ tasks: createTaskService(t.db), fs: coreFs, proc: testProc }))
    const now = Date.now()
    await t.db
      .insert(schema.workspaces)
      .values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values([
      {
        id: 'project-widget',
        name: 'widget',
        path: work,
        workspaceId: 'workspace-1',
        sort: 0,
        hidden: false,
        vcs: 'git',
        defaultBranch: 'main',
        remoteUrl: null,
        githubOwner: 'acme',
        githubName: 'widget',
        githubRepoId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'project-none',
        name: 'none',
        path: null,
        workspaceId: 'workspace-1',
        sort: 1,
        hidden: false,
        vcs: null,
        defaultBranch: null,
        remoteUrl: null,
        githubOwner: 'other',
        githubName: 'none',
        githubRepoId: null,
        createdAt: now,
        updatedAt: now,
      },
    ])
    // worktreePath = the checkout itself: taskRoot returns it directly (no worktree creation).
    await t.db.insert(schema.tasks).values({
      id: 'task1',
      title: 'T',
      origin: 'local',
      projectId: 'project-widget',
      branch: 'main',
      worktreePath: work,
      pullNumber: null,
      status: 'active',
      sort: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    // task2: repo has no mapped checkout → no worktree.
    await t.db.insert(schema.tasks).values({
      id: 'task2',
      title: 'U',
      origin: 'local',
      projectId: 'project-none',
      branch: 'main',
      worktreePath: null,
      pullNumber: null,
      status: 'active',
      sort: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
  })
  afterEach(() => {
    setEditorBridge(null)
    t.cleanup()
  })

  // editor.files, what a renderer's node part reads (../../contract/files.ts). The same confinement as
  // the routes, with every refusal answered the same way.
  it('gives another plugin disk bytes inside the worktree and nothing outside it', async () => {
    const files = editorFiles({ tasks: createTaskService(t.db), fs: coreFs, proc: testProc })
    const photo = await files.read({ taskId: 'task1', path: 'sub/photo.webp' })
    expect(photo).toEqual({
      status: 'ok',
      bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0xff]),
      revision: createHash('sha256')
        .update(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0xff]))
        .digest('hex'),
    })
    for (const [taskId, path] of [
      ['task1', 'escape/secret.txt'],
      ['task1', '../outside.txt'],
      ['task1', 'nope.txt'],
      ['task1', 'sub'],
      ['task2', 'hello.txt'],
      ['gone', 'hello.txt'],
    ]) {
      expect(await files.read({ taskId, path })).toEqual({ status: 'missing' })
    }
    writeFileSync(join(work, 'huge.bin'), '')
    truncateSync(join(work, 'huge.bin'), MAX_EDITOR_FILE_READ_BYTES + 1)
    try {
      expect(await files.read({ taskId: 'task1', path: 'huge.bin' })).toEqual({
        status: 'too_large',
        byteSize: MAX_EDITOR_FILE_READ_BYTES + 1,
      })
    } finally {
      rmSync(join(work, 'huge.bin'))
    }
  })

  it('reads, lists, files, and roots a real worktree', async () => {
    const app = authed()
    expect(await (await app.fetch(req('/api/tasks/task1/editor/read?path=hello.txt'), {} as Env)).json()).toEqual({
      text: 'hi there',
      revision: createHash('sha256').update('hi there').digest('hex'),
    })
    expect(await (await app.fetch(req('/api/tasks/task1/editor/root'), {} as Env)).json()).toEqual({ root: work })
    expect(
      await (await app.fetch(req('/api/tasks/task1/editor/line-markers?path=hello.txt'), {} as Env)).json(),
    ).toEqual([])
    const list = (await (await app.fetch(req('/api/tasks/task1/editor/list?path='), {} as Env)).json()) as {
      name: string
      dir: boolean
    }[]
    expect(list.find((e) => e.name === 'sub')).toMatchObject({ name: 'sub', dir: true, kind: 'folder', root: work })
    expect(list.find((e) => e.name === 'hello.txt')).toMatchObject({
      name: 'hello.txt',
      dir: false,
      kind: 'file',
      root: work,
    })
    const files = (await (await app.fetch(req('/api/tasks/task1/editor/files'), {} as Env)).json()) as string[]
    expect(files).toContain('hello.txt')
    expect(files).toContain('sub/a.ts')
  })

  it('creates exclusively and refuses a stale rename target without changing the replacement', async () => {
    const app = authed()
    const root = await (await app.fetch(req('/api/tasks/task1/editor/entry?path='), {} as Env)).json()
    const created = await (
      await app.fetch(
        req('/api/tasks/task1/editor/create', 'POST', { parent: root, name: '.new', kind: 'file' }),
        {} as Env,
      )
    ).json()
    expect(created).toEqual({ ok: true, path: '.new' })
    expect(existsSync(join(work, '.new'))).toBe(true)
    const duplicate = await (
      await app.fetch(
        req('/api/tasks/task1/editor/create', 'POST', { parent: root, name: '.new', kind: 'file' }),
        {} as Env,
      )
    ).json()
    expect(duplicate).toMatchObject({ ok: false })

    const source = await (await app.fetch(req('/api/tasks/task1/editor/entry?path=.new'), {} as Env)).json()
    rmSync(join(work, '.new'))
    writeFileSync(join(work, '.new'), 'replacement')
    const stale = await (
      await app.fetch(req('/api/tasks/task1/editor/rename', 'POST', { source, name: 'renamed' }), {} as Env)
    ).json()
    expect(stale).toMatchObject({ ok: false })
    expect(readFileSync(join(work, '.new'), 'utf8')).toBe('replacement')
    expect(existsSync(join(work, 'renamed'))).toBe(false)
  })

  it('announces missing native rename support before offering a mutation', async () => {
    const app = authed()
    const available = await (await app.fetch(req('/api/tasks/task1/editor/rename-availability'), {} as Env)).json()
    expect(available).toEqual({ available: true })
    process.env.ACORN_EXCLUSIVE_RENAME_DIR = outside
    try {
      const missing = await (await app.fetch(req('/api/tasks/task1/editor/rename-availability'), {} as Env)).json()
      expect(missing).toMatchObject({ available: false })
      const source = await (await app.fetch(req('/api/tasks/task1/editor/entry?path=hello.txt'), {} as Env)).json()
      const result = await (
        await app.fetch(req('/api/tasks/task1/editor/rename', 'POST', { source, name: 'not-moved.txt' }), {} as Env)
      ).json()
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('helper') })
      expect(existsSync(join(work, 'hello.txt'))).toBe(true)
    } finally {
      process.env.ACORN_EXCLUSIVE_RENAME_DIR = helperDir
    }
  })

  it('keeps stable entry identity across a write and rejects a same-kind replacement', async () => {
    const app = authed()
    const before = (await (await app.fetch(req('/api/tasks/task1/editor/entry?path=hello.txt'), {} as Env)).json()) as {
      entryId: string
      identity: string
    }
    writeFileSync(join(work, 'hello.txt'), 'acknowledged update')
    const written = (await (
      await app.fetch(req('/api/tasks/task1/editor/entry?path=hello.txt'), {} as Env)
    ).json()) as { entryId: string; identity: string }
    expect(written.entryId).toBe(before.entryId)
    expect(written.identity).not.toBe(before.identity)
    rmSync(join(work, 'hello.txt'))
    writeFileSync(join(work, 'hello.txt'), 'external replacement')
    const replacement = (await (
      await app.fetch(req('/api/tasks/task1/editor/entry?path=hello.txt'), {} as Env)
    ).json()) as { entryId: string }
    expect(replacement.entryId).not.toBe(before.entryId)
    const stale = await (
      await app.fetch(req('/api/tasks/task1/editor/rename', 'POST', { source: written, name: 'moved.txt' }), {} as Env)
    ).json()
    expect(stale).toMatchObject({ ok: false })
    expect(readFileSync(join(work, 'hello.txt'), 'utf8')).toBe('external replacement')
    writeFileSync(join(work, 'hello.txt'), 'hi there')
  })

  it('does not overwrite a destination created after route preflight', async () => {
    const from = join(work, 'race-source.txt')
    const to = join(work, 'race-destination.txt')
    writeFileSync(from, 'source content')
    const racedProc: EditorCoreServices['proc'] = {
      ...testProc,
      runProcess: async (spec) => {
        if (spec.file === join(helperDir, 'exclusive-rename') && spec.args?.[0] === from)
          writeFileSync(to, 'external winner')
        return testProc.runProcess(spec)
      },
    }
    setEditorBridge(editorBridge({ tasks: createTaskService(t.db), fs: coreFs, proc: racedProc }))
    const app = authed()
    const source = await (await app.fetch(req('/api/tasks/task1/editor/entry?path=race-source.txt'), {} as Env)).json()
    const result = await (
      await app.fetch(
        req('/api/tasks/task1/editor/rename', 'POST', { source, name: 'race-destination.txt' }),
        {} as Env,
      )
    ).json()
    expect(result).toMatchObject({ ok: false })
    expect(readFileSync(from, 'utf8')).toBe('source content')
    expect(readFileSync(to, 'utf8')).toBe('external winner')
    rmSync(from)
    rmSync(to)
  })

  it('renames a link entry without touching its outside target and refuses protected paths', async () => {
    const app = authed()
    symlinkSync(outside, join(work, 'escape-action'))
    const source = await (await app.fetch(req('/api/tasks/task1/editor/entry?path=escape-action'), {} as Env)).json()
    expect(source).toMatchObject({ kind: 'link', path: 'escape-action' })
    const moved = await (
      await app.fetch(req('/api/tasks/task1/editor/rename', 'POST', { source, name: 'moved-link' }), {} as Env)
    ).json()
    expect(moved).toEqual({ ok: true, path: 'moved-link' })
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('TOP SECRET')
    symlinkSync('hello.txt', join(work, 'linked-destination'))
    const file = await (await app.fetch(req('/api/tasks/task1/editor/entry?path=hello.txt'), {} as Env)).json()
    expect(
      await (
        await app.fetch(
          req('/api/tasks/task1/editor/rename', 'POST', { source: file, name: 'linked-destination' }),
          {} as Env,
        )
      ).json(),
    ).toMatchObject({ ok: false })
    expect(readFileSync(join(work, 'hello.txt'), 'utf8')).toBe('hi there')
    expect(existsSync(join(work, 'linked-destination'))).toBe(true)
    const root = await (await app.fetch(req('/api/tasks/task1/editor/entry?path='), {} as Env)).json()
    expect(
      await (
        await app.fetch(req('/api/tasks/task1/editor/rename', 'POST', { source: root, name: 'bad' }), {} as Env)
      ).json(),
    ).toMatchObject({ ok: false })
    expect(
      await (
        await app.fetch(
          req('/api/tasks/task1/editor/create', 'POST', { parent: root, name: '.git', kind: 'folder' }),
          {} as Env,
        )
      ).json(),
    ).toMatchObject({ ok: false })
    expect(
      await (
        await app.fetch(req('/api/tasks/task1/editor/entry?path=.git'), {} as Env)
      ).status,
    ).toBeGreaterThanOrEqual(400)
  })

  it('blocks a folder rename while a Node-owned external editor has a descendant open', async () => {
    const app = authed()
    const source = await (await app.fetch(req('/api/tasks/task1/editor/entry?path=sub'), {} as Env)).json()
    const release = await claimEditorPty(work, 'sub/a.ts')
    try {
      const blocked = await (
        await app.fetch(req('/api/tasks/task1/editor/rename', 'POST', { source, name: 'elsewhere' }), {} as Env)
      ).json()
      expect(blocked).toMatchObject({ ok: false, reason: expect.stringContaining('$EDITOR') })
      expect(existsSync(join(work, 'sub', 'a.ts'))).toBe(true)
    } finally {
      release()
    }
  })

  it('keeps file mutation routes device-only', async () => {
    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'internal', scope: 'task', taskId: 'task1', userId: 'james' })
      await next()
    })
    app.route('/api/tasks', editor)
    const root = await editorBridge({ tasks: createTaskService(t.db), fs: coreFs, proc: testProc }).entry('task1', '')
    expect(
      (
        await app.fetch(
          req('/api/tasks/task1/editor/create', 'POST', { parent: root, name: 'forbidden', kind: 'file' }),
          {} as Env,
        )
      ).status,
    ).toBe(403)
    expect(existsSync(join(work, 'forbidden'))).toBe(false)
  })

  it('preserves Unicode and spelling through a case-only rename', async () => {
    const app = authed()
    writeFileSync(join(work, 'Café notes.txt'), 'body')
    const source = await (
      await app.fetch(req('/api/tasks/task1/editor/entry?path=Caf%C3%A9%20notes.txt'), {} as Env)
    ).json()
    const result = await (
      await app.fetch(req('/api/tasks/task1/editor/rename', 'POST', { source, name: 'café notes.txt' }), {} as Env)
    ).json()
    expect(result).toEqual({ ok: true, path: 'café notes.txt' })
    expect(readFileSync(join(work, 'café notes.txt'), 'utf8')).toBe('body')
  })

  it.skipIf(process.env.ACORN_TEST_REAL_TRASH !== '1')(
    'moves a file and a folder through the owning Node trash adapter',
    async () => {
      const app = authed()
      writeFileSync(join(work, 'trash-file.txt'), 'recover me')
      mkdirSync(join(work, 'trash-folder'))
      writeFileSync(join(work, 'trash-folder', 'inside.txt'), 'recover both')
      symlinkSync(outside, join(work, 'trash-folder', 'outside-link'))
      for (const path of ['trash-file.txt', 'trash-folder']) {
        const source = await (
          await app.fetch(req(`/api/tasks/task1/editor/entry?path=${encodeURIComponent(path)}`), {} as Env)
        ).json()
        expect(
          await (await app.fetch(req('/api/tasks/task1/editor/trash', 'POST', { source }), {} as Env)).json(),
        ).toEqual({ ok: true, path })
        expect(existsSync(join(work, path))).toBe(false)
      }
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('TOP SECRET')
    },
  )

  it('writes within the worktree', async () => {
    const revision = createHash('sha256').update('export const a = 1\n').digest('hex')
    const res = await authed().fetch(
      req('/api/tasks/task1/editor/file', 'PUT', {
        path: 'sub/a.ts',
        content: 'export const a = 2\n',
        expectedRevision: revision,
      }),
      {} as Env,
    )
    expect(await res.json()).toMatchObject({
      ok: true,
      text: expect.any(String),
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(readFileSync(join(work, 'sub', 'a.ts'), 'utf8')).toBe('export const a = 2\n')
  })

  it('round-trips Unicode, BOM, genuine replacement characters, and a complete 17 MiB file', async () => {
    const bridge = editorBridge({ tasks: createTaskService(t.db), fs: coreFs, proc: testProc })
    const text = '\ufeff😀 café\r\n\ufffd\n' + 'a'.repeat(17 * 1024 * 1024) + '\nEND'
    writeFileSync(join(work, 'large.txt'), text)
    expect(await bridge.read('task1', 'large.txt')).toEqual({
      text,
      revision: createHash('sha256').update(text).digest('hex'),
    })
    const result = await bridge.write('task1', 'large.txt', text, createHash('sha256').update(text).digest('hex'))
    expect(result).toMatchObject({ ok: true, text })
    expect(readFileSync(join(work, 'large.txt')).equals(Buffer.from(text))).toBe(true)
  })

  it('visibly rejects invalid UTF-8 and binary data without changing source bytes', async () => {
    const app = authed()
    for (const [name, bytes] of [
      ['invalid.txt', Buffer.from([0xc3, 0x28])],
      ['binary.txt', Buffer.from([65, 0, 66])],
    ] as const) {
      writeFileSync(join(work, name), bytes)
      const result = await app.fetch(req(`/api/tasks/task1/editor/read?path=${name}`), {} as Env)
      expect(result.status).toBe(422)
      expect(await result.json()).toMatchObject({ error: { code: 'unsupported_text' } })
      expect(readFileSync(join(work, name))).toEqual(bytes)
    }
  })

  it('acknowledges the exact formatter body and preserves hook veto and invalidation', async () => {
    let changes = 0
    const core = { tasks: createTaskService(t.db), fs: coreFs, proc: testProc }
    const formatted = editorBridge(
      core,
      () => {
        changes++
      },
      { run: async (_id, payload) => ({ ok: true, payload: { ...payload, text: 'formatted\n' } }) },
    )
    const result = await formatted.write(
      'task1',
      'hello.txt',
      'submitted',
      createHash('sha256').update('hi there').digest('hex'),
    )
    expect(result).toMatchObject({ ok: true, text: 'formatted\n', revision: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(readFileSync(join(work, 'hello.txt'), 'utf8')).toBe('formatted\n')
    expect(changes).toBe(1)
    const vetoed = editorBridge(
      core,
      () => {
        changes++
      },
      { run: async (_id, payload) => ({ ok: false, payload, by: 'formatter', reason: 'veto' }) },
    )
    expect(await vetoed.write('task1', 'hello.txt', 'rejected', result.ok ? result.revision : '')).toEqual({
      ok: false,
      kind: 'failure',
      reason: 'formatter: veto',
    })
    expect(readFileSync(join(work, 'hello.txt'), 'utf8')).toBe('formatted\n')
    expect(changes).toBe(1)
  })

  it('preserves newer disk bytes after an external edit, a formatter edit, or deletion', async () => {
    const path = join(work, 'guarded.txt')
    writeFileSync(path, '\ufefffirst\r\n')
    const core = { tasks: createTaskService(t.db), fs: coreFs, proc: testProc }
    const bridge = editorBridge(core)
    const original = await bridge.read('task1', 'guarded.txt')
    expect(original.revision).toBe(createHash('sha256').update(Buffer.from('\ufefffirst\r\n')).digest('hex'))
    writeFileSync(path, 'external\n')
    expect(await bridge.write('task1', 'guarded.txt', 'draft', original.revision)).toMatchObject({
      ok: false,
      kind: 'conflict',
    })
    expect(readFileSync(path, 'utf8')).toBe('external\n')

    const fresh = await bridge.read('task1', 'guarded.txt')
    const formatting = editorBridge(core, undefined, {
      run: async (_id, payload) => {
        writeFileSync(path, 'formatter neighbor\n')
        return { ok: true, payload: { ...payload, text: 'formatted draft\n' } }
      },
    })
    expect(await formatting.write('task1', 'guarded.txt', 'draft', fresh.revision)).toMatchObject({
      ok: false,
      kind: 'conflict',
    })
    expect(readFileSync(path, 'utf8')).toBe('formatter neighbor\n')

    const beforeDelete = await bridge.read('task1', 'guarded.txt')
    rmSync(path)
    expect(await bridge.write('task1', 'guarded.txt', 'draft', beforeDelete.revision)).toMatchObject({
      ok: false,
      kind: 'deleted',
    })
    expect(existsSync(path)).toBe(false)
    writeFileSync(path, 'another writer')
    expect(await bridge.write('task1', 'guarded.txt', 'draft', null)).toMatchObject({ ok: false, kind: 'conflict' })
    expect(readFileSync(path, 'utf8')).toBe('another writer')
  })

  it('requires a disk precondition on the file route', async () => {
    const app = authed()
    const response = await app.fetch(
      req('/api/tasks/task1/editor/file', 'PUT', { path: 'hello.txt', content: 'old client' }),
      {} as Env,
    )
    expect(response.status).toBe(400)
    expect(readFileSync(join(work, 'hello.txt'), 'utf8')).not.toBe('old client')
  })

  it('serializes writes through aliased task roots and releases the lock after a conflict', async () => {
    const alias = join(outside, 'checkout-alias')
    symlinkSync(work, alias)
    const path = join(work, 'alias-guard.txt')
    writeFileSync(path, 'base')
    const revision = (
      await editorBridge({ tasks: createTaskService(t.db), fs: coreFs, proc: testProc }).read(
        'task1',
        'alias-guard.txt',
      )
    ).revision
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let hooksEntered = 0
    const tasks = { ...createTaskService(t.db), root: async (taskId: string) => (taskId === 'alias' ? alias : work) }
    const bridge = editorBridge({ tasks, fs: coreFs, proc: testProc }, undefined, {
      run: async (_id, payload) => {
        hooksEntered++
        if (hooksEntered === 1) {
          entered()
          await held
        }
        return { ok: true, payload }
      },
    })
    const first = bridge.write('task1', 'alias-guard.txt', 'first', revision)
    await started
    const second = bridge.write('alias', 'alias-guard.txt', 'second', revision)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(hooksEntered).toBe(1)
    release()
    expect(await first).toMatchObject({ ok: true, text: 'first' })
    expect(await second).toMatchObject({ ok: false, kind: 'conflict' })
    expect(readFileSync(path, 'utf8')).toBe('first')
    expect(
      await bridge.write('alias', 'alias-guard.txt', 'third', (await bridge.read('alias', 'alias-guard.txt')).revision),
    ).toMatchObject({ ok: true })
  })

  it('invalidates every mapped task alias after a file action', async () => {
    const alias = join(outside, 'action-alias')
    symlinkSync(work, alias)
    const now = Date.now()
    await t.db.insert(schema.tasks).values({
      id: 'alias-task',
      title: 'Alias',
      origin: 'local',
      projectId: 'project-widget',
      branch: 'alias',
      worktreePath: alias,
      pullNumber: null,
      status: 'active',
      sort: 2,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    const changed: string[] = []
    const bridge = editorBridge({ tasks: createTaskService(t.db), fs: coreFs, proc: testProc }, (taskId) =>
      changed.push(taskId),
    )
    writeFileSync(join(work, 'alias-event.txt'), 'event')
    const source = await bridge.entry('task1', 'alias-event.txt')
    expect(await bridge.rename('task1', source, 'renamed-alias.txt')).toEqual({ ok: true, path: 'renamed-alias.txt' })
    expect(changed).toEqual(['task1', 'alias-task'])
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
    expect((await app.fetch(req('/api/tasks/task1/editor/image?path=..%2F..%2Foutside.png'), {} as Env)).status).toBe(
      403,
    )
    expect((await app.fetch(req('/api/tasks/task1/editor/image?path=escape%2Fsecret.png'), {} as Env)).status).toBe(403)
    expect((await app.fetch(req('/api/tasks/task2/editor/image?path=photo.webp'), {} as Env)).status).toBe(404)
  })

  it('merges optional marker providers and keeps a failed source isolated', async () => {
    setEditorBridge(
      editorBridge(
        { tasks: createTaskService(t.db), fs: coreFs, proc: testProc },
        () => {},
        undefined,
        () => [
          {
            kind: 'pull-request',
            read: async () => [
              { from: 2, to: 3 },
              { from: 3, to: 4 },
            ],
          },
          { kind: 'pull-request', read: async () => [{ from: 8, to: 8 }] },
          {
            kind: 'uncommitted',
            read: async () => {
              throw new Error('status unavailable')
            },
          },
        ],
      ),
    )
    const response = await authed().fetch(req('/api/tasks/task1/editor/line-markers?path=hello.txt'), {} as Env)
    expect(await response.json()).toEqual([
      {
        kind: 'pull-request',
        ranges: [
          { from: 2, to: 4 },
          { from: 8, to: 8 },
        ],
      },
    ])
  })

  it('serves task status through an optional provider and drops an unloaded provider response', async () => {
    let release!: (value: { kind: 'ready'; changes: [] }) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const provider = {
      read: () =>
        new Promise<{ kind: 'ready'; changes: [] }>((resolve) => {
          release = resolve
          entered()
        }),
    }
    let loaded = true
    setEditorBridge(
      editorBridge(
        { tasks: createTaskService(t.db), fs: coreFs, proc: testProc },
        undefined,
        undefined,
        undefined,
        () => (loaded ? [provider] : []),
      ),
    )
    const app = authed()
    const route = '/api/tasks/task1/editor/file-status'
    const pending = app.fetch(req(route), {} as Env)
    await started
    loaded = false
    release({ kind: 'ready', changes: [] })
    expect(await (await pending).json()).toEqual({ kind: 'unavailable' })
    expect(await (await app.fetch(req(route), {} as Env)).json()).toEqual({ kind: 'unavailable' })
  })

  it('pairs exact UTF-8 marker bodies and isolates failed and legacy providers', async () => {
    const text = '\ufeff😀 café\r\nsecond\n'
    writeFileSync(join(work, 'markers.txt'), text)
    const revision = createHash('sha256').update(text).digest('hex')
    setEditorBridge(
      editorBridge({ tasks: createTaskService(t.db), fs: coreFs, proc: testProc }, undefined, undefined, () => [
        { kind: 'pull-request', read: async () => [{ from: 2, to: 2 }] },
        {
          kind: 'uncommitted',
          read: async () => {
            throw new Error('optional failure')
          },
        },
      ]),
    )
    const app = authed()
    const route = '/api/tasks/task1/editor/line-markers?path=markers.txt&revision='
    expect(await (await app.fetch(req(route + revision), {} as Env)).json()).toEqual({
      revision,
      markers: [{ kind: 'pull-request', ranges: [{ from: 2, to: 2 }] }],
    })
    expect(await (await app.fetch(req(route + '0'.repeat(64)), {} as Env)).json()).toEqual({
      revision: null,
      markers: [],
    })
    expect((await app.fetch(req(route + 'invalid'), {} as Env)).status).toBe(400)
    expect(
      (
        await app.fetch(
          req('/api/tasks/task1/editor/line-markers?path=escape%2Fsecret.txt&revision=' + revision),
          {} as Env,
        )
      ).status,
    ).toBe(403)
  })

  it.each(['same-size-restored-mtime', 'write-and-restore', 'root-change'])(
    'rejects %s during provider work and admits a fresh retry',
    async (mode) => {
      const path = join(work, 'held-markers.txt')
      const original = 'first\nsecond\n'
      writeFileSync(path, original)
      const stamp = statSync(path)
      const revision = createHash('sha256').update(original).digest('hex')
      let release!: () => void
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const hold = new Promise<void>((resolve) => {
        release = resolve
      })
      let root = work
      const core = { tasks: { ...createTaskService(t.db), root: async () => root }, fs: coreFs, proc: testProc }
      const bridge = editorBridge(core, undefined, undefined, () => [
        {
          kind: 'pull-request',
          read: async (_task, _path, source) => {
            expect(source?.root).toBe(root)
            entered()
            await hold
            return [{ from: 2, to: 2 }]
          },
        },
      ])
      const response = bridge.markerSnapshot!('task1', 'held-markers.txt', revision)
      await started
      if (mode === 'root-change') {
        root = outside
        writeFileSync(join(outside, 'held-markers.txt'), original)
      } else {
        writeFileSync(path, 'other\nsecond\n')
        if (mode === 'write-and-restore') writeFileSync(path, original)
        utimesSync(path, stamp.atime, stamp.mtime)
      }
      release()
      expect(await response).toEqual({ revision: null, markers: [] })
      root = work
      writeFileSync(path, original)
      expect(await bridge.markerSnapshot!('task1', 'held-markers.txt', revision)).toEqual({
        revision,
        markers: [{ kind: 'pull-request', ranges: [{ from: 2, to: 2 }] }],
      })
    },
  )

  it('rejects path traversal on read (403) and write ({ok:false}) — outside file untouched', async () => {
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/editor/read?path=../../../etc/passwd'), {} as Env)).status).toBe(403)
    const w = await app.fetch(
      req('/api/tasks/task1/editor/file', 'PUT', { path: '../escape-write.txt', content: 'x', expectedRevision: null }),
      {} as Env,
    )
    expect(await w.json()).toMatchObject({ ok: false })
  })

  it('rejects a symlink that escapes the worktree (403), never leaking the outside file', async () => {
    const res = await authed().fetch(req('/api/tasks/task1/editor/read?path=escape/secret.txt'), {} as Env)
    expect(res.status).toBe(403)
    const w = await authed().fetch(
      req('/api/tasks/task1/editor/file', 'PUT', {
        path: 'escape/secret.txt',
        content: 'pwned',
        expectedRevision: null,
      }),
      {} as Env,
    )
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
    const refused = await app.fetch(
      req('/api/tasks/task1/editor/file', 'PUT', {
        path: 'dangling.txt',
        content: 'synthetic content',
        expectedRevision: null,
      }),
      {} as Env,
    )
    expect(await refused.json()).toMatchObject({ ok: false })
    expect(existsSync(outsideTarget)).toBe(false)
    const written = await app.fetch(
      req('/api/tasks/task1/editor/file', 'PUT', {
        path: 'sub/new.txt',
        content: 'ordinary content',
        expectedRevision: null,
      }),
      {} as Env,
    )
    expect(await written.json()).toMatchObject({
      ok: true,
      text: expect.any(String),
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(readFileSync(join(work, 'sub/new.txt'), 'utf8')).toBe('ordinary content')
  })

  it('refuses to save git metadata, by path or through a link in the worktree', async () => {
    const config = join(work, '.git', 'config')
    const before = readFileSync(config, 'utf8')
    const revision = createHash('sha256').update(before).digest('hex')
    symlinkSync(join(work, '.git'), join(work, 'git-alias'))
    const app = authed()
    for (const path of ['.git/config', '.GIT/config', 'git-alias/config']) {
      const res = await app.fetch(
        req('/api/tasks/task1/editor/file', 'PUT', {
          path,
          content: '[core]\n\tfsmonitor = touch pwned\n',
          expectedRevision: revision,
        }),
        {} as Env,
      )
      expect(await res.json()).toMatchObject({ ok: false, reason: 'Git metadata cannot be changed.' })
    }
    const fresh = await app.fetch(
      req('/api/tasks/task1/editor/file', 'PUT', {
        path: 'git-alias/hooks/pre-commit',
        content: 'x',
        expectedRevision: null,
      }),
      {} as Env,
    )
    expect(await fresh.json()).toMatchObject({ ok: false })
    expect(readFileSync(config, 'utf8')).toBe(before)
    expect(existsSync(join(work, '.git', 'hooks', 'pre-commit'))).toBe(false)
    rmSync(join(work, 'git-alias'))
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
