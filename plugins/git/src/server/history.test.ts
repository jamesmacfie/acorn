import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '@acorn/plugin-api/node'
import type { CoreServices } from '@acorn/plugin-api/node'
import { _clearHistorySnapshots, history } from './history'
import { revision, segments, search, fileText, revisionCacheStats } from './revision'
import { historyRoutes } from './routes/history'

let folder = ''
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = ''
})
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const write = (root: string, path: string, content: string) => writeFileSync(join(root, path), content)
function fixture(objectFormat?: 'sha256') {
  folder = mkdtempSync(join(tmpdir(), 'acorn-history-'))
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q', ...(objectFormat ? [`--object-format=${objectFormat}`] : []))
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  return root
}
function core(root: string, count?: (args: readonly string[]) => void) {
  return {
    projects: { byId: async (id: string) => (id === 'project' ? { id, path: root } : null) },
    git: {
      git: async (args: readonly string[], opts: { cwd: string; signal?: AbortSignal; stdin?: string }) => {
        count?.(args)
        return await new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
          const child = spawn('git', [...args], { cwd: opts.cwd, signal: opts.signal })
          const stdout: Buffer[] = [],
            stderr: Buffer[] = []
          // Git can exit without reading stdin, which gives EPIPE. Its exit code is the answer, as in core's runner.
          child.stdin.on('error', () => undefined)
          child.stdin.end(opts.stdin ?? '')
          child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
          child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
          child.on('error', fail)
          child.on('close', (code) =>
            done({
              code: code ?? 1,
              stdout: Buffer.concat(stdout).toString(),
              stderr: Buffer.concat(stderr).toString(),
            }),
          )
        })
      },
    },
  } as unknown as Pick<CoreServices, 'git' | 'projects'>
}
const filter = { ref: null, field: 'message' as const, query: '' }

it('pins pages when a branch moves, keeps all merge parents, and searches bounded fields', async () => {
  const root = fixture()
  write(root, 'a.txt', 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  const rootId = git(root, 'rev-parse', 'HEAD')
  git(root, 'checkout', '-qb', 'side')
  write(root, 'side.txt', 'side\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Side')
  git(root, 'checkout', '-q', '-')
  write(root, 'main.txt', 'main\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Main')
  git(root, 'merge', '--no-ff', '-qm', 'Merge both', 'side')
  const service = core(root)
  const first = await history(service, 'project', filter, null)
  expect(first.commits[0]?.parents).toHaveLength(2)
  const merge = first.commits[0]!
  expect((await revision(service, 'project', merge.id, merge.parents[1])).base).toBe(merge.parents[1])
  await expect(revision(service, 'project', merge.id, rootId)).rejects.toMatchObject({ code: 'bad_base' })
  expect(first.commits.some((commit) => commit.id === rootId && !commit.parents.length)).toBe(true)
  expect(
    (await history(service, 'project', { ...filter, field: 'hash', query: rootId.slice(0, 10) }, null)).commits.map(
      (commit) => commit.id,
    ),
  ).toEqual([rootId])
  expect(
    (await history(service, 'project', { ...filter, field: 'author', query: 'test@acorn.dev' }, null)).commits.length,
  ).toBeGreaterThan(0)
  expect((await history(service, 'project', { ...filter, query: 'MERGE BOTH' }, null)).commits).toHaveLength(1)
  for (let i = 0; i < 105; i++) git(root, 'commit', '--allow-empty', '-qm', `Extra ${i}`)
  const page = await history(service, 'project', filter, null)
  expect(page.commits).toHaveLength(100)
  expect(page.nextCursor).toBeTruthy()
  const beyondSearchLimit = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString()) as { offset: number }
  beyondSearchLimit.offset = 5_100
  expect(
    (await history(service, 'project', filter, Buffer.from(JSON.stringify(beyondSearchLimit)).toString('base64url')))
      .commits,
  ).toEqual([])
  await expect(
    history(
      service,
      'project',
      { ...filter, query: 'Extra' },
      Buffer.from(JSON.stringify({ ...beyondSearchLimit, filter: { ...filter, query: 'Extra' } })).toString(
        'base64url',
      ),
    ),
  ).rejects.toMatchObject({ code: 'bad_cursor' })
  git(root, 'commit', '--allow-empty', '-qm', 'Moved ref')
  const next = await history(service, 'project', filter, page.nextCursor)
  expect(new Set([...page.commits, ...next.commits].map((commit) => commit.id)).size).toBe(
    page.commits.length + next.commits.length,
  )
  expect(
    next.commits.some((commit) => commit.id === rootId),
    next.commits.map((commit) => commit.subject).join(', '),
  ).toBe(true)
  _clearHistorySnapshots()
  await expect(history(service, 'project', filter, page.nextCursor)).rejects.toMatchObject({ code: 'history_expired' })
})

it('compares a SHA-256 root against its repository empty tree', async () => {
  const root = fixture('sha256')
  write(root, 'one.txt', 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  const id = git(root, 'rev-parse', 'HEAD')
  expect(id).toHaveLength(64)
  const detail = await revision(core(root), 'project', id)
  expect(detail.base).toBeNull()
  expect(detail.files.map((file) => file.path)).toEqual(['one.txt'])
  expect(detail.topology.files[0]?.segments.length).toBeGreaterThan(0)
})

it('does not cache a patch read cancelled after topology', async () => {
  const root = fixture()
  write(root, 'one.txt', 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  const id = git(root, 'rev-parse', 'HEAD')
  const controller = new AbortController()
  const aborted = core(root, (args) => {
    if (args.includes('--patch')) controller.abort()
  })
  await expect(revision(aborted, 'project', id, undefined, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  const calls: string[] = []
  const complete = await revision(
    core(root, (args) => calls.push(args[0]!)),
    'project',
    id,
  )
  expect(complete.files).toHaveLength(1)
  expect(calls).toContain('-c')
})

it('aborts gap reads at the blob-size and blob-content steps', async () => {
  const root = fixture()
  write(root, 'one.txt', 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  const id = git(root, 'rev-parse', 'HEAD')
  const file = (await revision(core(root), 'project', id)).topology.files[0]!
  for (const step of ['-s', 'blob']) {
    const controller = new AbortController()
    const service = core(root, (args) => {
      if (args[0] === 'cat-file' && args[1] === step) controller.abort()
    })
    await expect(fileText(service, 'project', id, null, file.path, file.sha!, controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    )
  }
  expect((await fileText(core(root), 'project', id, null, file.path, file.sha!)).text).toBe('one\n')
})

it('includes detached HEAD and names an unborn repository without inventing history', async () => {
  const root = fixture()
  const empty = await history(core(root), 'project', filter, null)
  expect(empty.commits).toEqual([])
  expect(empty.refs).toEqual([])
  write(root, 'one.txt', 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'First')
  const id = git(root, 'rev-parse', 'HEAD')
  git(root, 'checkout', '--detach', '-q', id)
  const detached = await history(core(root), 'project', filter, null)
  expect(detached.commits[0]?.id).toBe(id)
  expect(detached.commits[0]?.refs).toContain('HEAD')
})

it('reads history in a repository with thousands of refs', async () => {
  const root = fixture()
  write(root, 'one.txt', 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'First')
  const id = git(root, 'rev-parse', 'HEAD')
  const refs = Array.from({ length: 3_000 }, (_, index) => `create refs/tags/release-${index} ${id}\n`).join('')
  execFileSync('git', ['update-ref', '--stdin'], { cwd: root, input: refs })
  const page = await history(core(root), 'project', filter, null)
  expect(page.commits.map((commit) => commit.id)).toEqual([id])
  expect(page.refs).toHaveLength(3_002)
})

it('serves root, rename, mode, delete, binary and unusual names through topology then lazy rows', async () => {
  const root = fixture()
  write(root, 'old name.txt', 'one\ntwo\n')
  write(root, 'delete.txt', 'gone\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  const rootId = git(root, 'rev-parse', 'HEAD')
  git(root, 'mv', 'old name.txt', 'new\nname.txt')
  write(root, 'new\nname.txt', 'one\nTWO\n')
  git(root, 'rm', 'delete.txt')
  write(root, 'binary.bin', '\x00\x01\x02')
  write(root, 'script.sh', '#!/bin/sh\n')
  git(root, 'add', '.')
  git(root, 'update-index', '--chmod=+x', 'script.sh')
  git(root, 'commit', '-qm', 'Rename and mode')
  const id = git(root, 'rev-parse', 'HEAD')
  const calls: string[] = []
  const service = core(root, (args) => calls.push(args[0]!))
  const rootDetail = await revision(service, 'project', rootId)
  expect(rootDetail.base).toBeNull()
  expect(rootDetail.files.map((file) => file.path)).toContain('old name.txt')
  const detail = await revision(service, 'project', id)
  expect(detail.base).toBe(rootId)
  expect(detail.files.find((file) => file.path === 'delete.txt')?.status).toBe('D')
  expect(detail.files.find((file) => file.path === 'binary.bin')?.binary).toBe(true)
  expect(detail.files.find((file) => file.path === 'new\nname.txt')?.oldPath).toBe('old name.txt')
  expect(detail.files.find((file) => file.path === 'script.sh')?.newMode).toBe('100755')
  const request = detail.topology.files.flatMap((file) =>
    file.patchKey && file.segments.length ? [{ path: file.path, patchKey: file.patchKey, ordinal: 0 }] : [],
  )[0]!
  expect(request).toBeTruthy()
  expect((await segments(service, 'project', id, rootId, [request]))[0]?.rows.length).toBeGreaterThan(0)
  expect(
    (await search(service, 'project', id, rootId, { query: 'TWO', caseSensitive: false, cursor: null })).matches.length,
  ).toBeGreaterThan(0)
  const textFile = detail.topology.files.find((file) => file.path === 'new\nname.txt')!
  expect((await fileText(service, 'project', id, rootId, textFile.path, textFile.sha!)).text).toContain('TWO')
  expect(revisionCacheStats().bytes).toBeLessThanOrEqual(32 << 20)
  expect(calls.filter((call) => call === 'diff').length).toBeGreaterThan(0)
})

it('gates history and revision documents to paired devices', async () => {
  const root = fixture()
  write(root, 'a.txt', 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  const id = git(root, 'rev-parse', 'HEAD')
  const service = core(root)
  const device = new Hono<AppEnv>()
  device.use('*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'person' })
    await next()
  })
  device.route('/api', historyRoutes(service))
  const task = new Hono<AppEnv>()
  task.use('*', async (c, next) => {
    c.set('principal', { kind: 'internal', userId: 'person', scope: 'task', taskId: 'a' })
    await next()
  })
  task.route('/api', historyRoutes(service))
  expect((await task.request('/api/projects/project/history')).status).toBe(403)
  expect((await task.request(`/api/projects/project/revisions/${id}`)).status).toBe(403)
  expect((await device.request('/api/projects/project/history')).status).toBe(200)
  expect((await device.request(`/api/projects/project/revisions/${id}`)).status).toBe(200)
})
