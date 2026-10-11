import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CompiledCoreServices, CoreServices, TaskRef } from '@acorn/plugin-api/node'
import { CONFLICT_TEXT_BYTES, conflictDetail, resolveConflict } from './conflicts'
import type { ConflictResolution } from '../shared/api'

let folder = ''
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = ''
})
const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, GIT_EDITOR: ':' },
    }).trim()
  } catch (error) {
    return (error as { stdout?: string }).stdout ?? ''
  } // Conflicting commands exit nonzero on purpose.
}

/** A repository where `main` and `feature` both change `shared` from a common base. */
function fixture(options: { failAdd?: boolean; busy?: boolean } = {}) {
  folder = mkdtempSync(join(tmpdir(), 'acorn-conflict-'))
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  const commit = (files: Record<string, string | null>, message: string) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) git(root, 'rm', '-q', '--', path)
      else {
        mkdirSync(join(root, path, '..'), { recursive: true })
        writeFileSync(join(root, path), text)
        git(root, 'add', '--', path)
      }
    }
    git(root, 'commit', '-qm', message)
  }
  const task: TaskRef = {
    id: 'task',
    title: 'Task',
    projectId: 'project',
    branch: null,
    worktreePath: null,
    skipSetup: false,
    pullNumber: null,
  }
  const core = {
    // Lexical confinement only. Core's own tests cover symlinked ancestors.
    fs: {
      resolveInRoot: (base: string, path: string) => {
        const abs = resolve(base, path)
        return abs.startsWith(base + sep) ? abs : null
      },
    },
    projects: { byId: async (id: string) => (id === 'project' ? { id, path: root } : null) },
    tasks: { load: async (id: string) => (id === task.id ? task : undefined) },
    checkoutAdmission: {
      activity: async () => [],
      write: async (_: string, action: (path: string) => Promise<unknown>) => {
        if (options.busy) throw Object.assign(new Error('An agent turn is active.'), { code: 'checkout_busy' })
        return action(root)
      },
    },
    git: {
      git: async (args: readonly string[], opts: { cwd: string; stdoutEncoding?: BufferEncoding }) =>
        new Promise<{ code: number; stdout: string; stderr: string; truncated: boolean }>((done) => {
          if (options.failAdd && args.includes('add'))
            return done({ code: 128, stdout: '', stderr: 'fatal: index.lock exists', truncated: false })
          const child = spawn('git', [...args], {
            cwd: opts.cwd,
            env: { ...process.env, GIT_EDITOR: 'false', GIT_TERMINAL_PROMPT: '0' },
          })
          const stdout: Buffer[] = [],
            stderr: Buffer[] = []
          child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
          child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
          child.on('close', (code) =>
            done({
              code: code ?? 1,
              stdout: Buffer.concat(stdout).toString(opts.stdoutEncoding ?? 'utf8'),
              stderr: Buffer.concat(stderr).toString(),
              truncated: false,
            }),
          )
        }),
    },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'tasks' | 'fs'> &
    Pick<CompiledCoreServices, 'checkoutAdmission'>
  const read = (path: string, signal?: AbortSignal) => conflictDetail(core, 'task', path, signal)
  const save = async (path: string, resolution: ConflictResolution, fingerprint?: string) =>
    resolveConflict(core, 'task', {
      expectedPath: root,
      path,
      fingerprint: fingerprint ?? (await read(path)).fingerprint,
      resolution,
    })
  return { root, commit, read, save, status: () => git(root, 'status', '--porcelain') }
}

it('reads base, ours, and theirs for a merge, saves a resolution, and stages it', async () => {
  const { root, commit, read, save, status } = fixture()
  commit({ shared: 'base\n' }, 'Base')
  git(root, 'checkout', '-qb', 'feature')
  commit({ shared: 'feature\n' }, 'Feature')
  git(root, 'checkout', '-q', 'main')
  commit({ shared: 'main\n' }, 'Main')
  git(root, 'merge', 'feature')
  const detail = await read('shared')
  expect(detail.operation).toBe('merge')
  expect(detail.sides.map((side) => [side.label.split(' ')[0], side.text])).toEqual([
    ['Common', 'base\n'],
    ['Task', 'main\n'],
    ['Merging', 'feature\n'],
  ])
  expect(detail.result.text).toContain('<<<<<<<')
  expect(detail.unsupported).toBeNull()
  await expect(save('shared', { kind: 'text', text: detail.result.text! })).rejects.toMatchObject({
    code: 'unresolved_markers',
  })
  const result = await save('shared', { kind: 'text', text: 'both\n' })
  expect(result).toMatchObject({ ok: true, saved: true, state: { operation: 'merge', conflicts: [] } })
  expect(readFileSync(join(root, 'shared'), 'utf8')).toBe('both\n')
  expect(status()).toBe('M  shared')
  await expect(read('shared')).rejects.toMatchObject({ code: 'not_conflicted' })
})

it('labels a rebase with the replayed task commit as theirs', async () => {
  const { root, commit, read } = fixture()
  commit({ shared: 'base\n' }, 'Base')
  git(root, 'checkout', '-qb', 'feature')
  commit({ shared: 'feature\n' }, 'Feature')
  git(root, 'checkout', '-q', 'main')
  commit({ shared: 'main\n' }, 'Main')
  git(root, 'checkout', '-q', 'feature')
  git(root, '-c', 'rebase.updateRefs=false', 'rebase', 'main')
  const detail = await read('shared')
  expect(detail.operation).toBe('rebase')
  expect(detail.sides[1]).toMatchObject({ label: expect.stringContaining('Rebased so far onto'), text: 'main\n' })
  expect(detail.sides[2]).toMatchObject({ label: 'Task commit being replayed', text: 'feature\n' })
})

it('labels cherry-pick, revert, and stash conflicts by what each side holds', async () => {
  const { root, commit, read, save } = fixture()
  commit({ shared: 'base\n' }, 'Base')
  git(root, 'checkout', '-qb', 'feature')
  commit({ shared: 'feature\n' }, 'Feature')
  git(root, 'checkout', '-q', 'main')
  commit({ shared: 'main\n' }, 'Main')
  git(root, 'cherry-pick', 'feature')
  expect((await read('shared')).sides.map((side) => side.label.split(' ')[0])).toEqual(['Parent', 'Task', 'Picked'])
  git(root, 'cherry-pick', '--abort')

  commit({ shared: 'later\n' }, 'Later')
  git(root, 'revert', '--no-edit', 'HEAD~1')
  const reverted = await read('shared')
  expect(reverted.sides.map((side) => [side.label.split(' ')[0], side.text])).toEqual([
    ['Reverted', 'main\n'],
    ['Task', 'later\n'],
    ['Parent', 'base\n'],
  ])
  git(root, 'revert', '--abort')

  writeFileSync(join(root, 'shared'), 'stashed\n')
  git(root, 'stash', 'push', '-qm', 'wip')
  commit({ shared: 'moved\n' }, 'Moved')
  git(root, 'stash', 'apply')
  const stash = await read('shared')
  expect(stash.operation).toBeNull()
  expect(stash.sides.map((side) => [side.label, side.text])).toEqual([
    ['Stash base', 'later\n'],
    ['Checkout', 'moved\n'],
    ['Stash', 'stashed\n'],
  ])
  expect(await save('shared', { kind: 'text', text: 'moved\nstashed\n' })).toMatchObject({
    ok: true,
    state: { operation: null, conflicts: [] },
  })
})

it('represents add/add and modify/delete, and deletes a file only when asked', async () => {
  const { root, commit, read, save, status } = fixture()
  commit({ keep: 'base\n', gone: 'base\n' }, 'Base')
  git(root, 'checkout', '-qb', 'feature')
  commit({ added: 'feature\n', gone: null }, 'Feature')
  git(root, 'checkout', '-q', 'main')
  commit({ added: 'main\n', gone: 'changed\n' }, 'Main')
  git(root, 'merge', 'feature')
  const added = await read('added')
  expect(added.sides.map((side) => side.present)).toEqual([false, true, true])
  const deleted = await read('gone')
  expect(deleted.sides.map((side) => [side.present, side.text])).toEqual([
    [true, 'base\n'],
    [true, 'changed\n'],
    [false, null],
  ])
  expect(deleted.result).toMatchObject({ present: true, text: 'changed\n' })
  expect(await save('gone', { kind: 'delete' })).toMatchObject({ ok: true, saved: true, revision: null })
  expect(existsSync(join(root, 'gone'))).toBe(false)
  expect(status()).toContain('D  gone')
  // Taking the side that kept the file is ordinary text, not an empty-file substitute.
  expect(await save('added', { kind: 'text', text: 'main\n' })).toMatchObject({ ok: true })
})

it('writes a result whose working file is absent and handles unusual names literally', async () => {
  const { root, commit, read, save, status } = fixture()
  const odd = 'dir/[a] *.ts'
  commit({ [odd]: 'base\n', other: 'base\n' }, 'Base')
  git(root, 'checkout', '-qb', 'feature')
  commit({ [odd]: 'feature\n', other: 'feature\n' }, 'Feature')
  git(root, 'checkout', '-q', 'main')
  commit({ [odd]: null, other: 'main\n' }, 'Main')
  git(root, 'merge', 'feature')
  rmSync(join(root, odd), { force: true })
  const detail = await read(odd)
  expect(detail.sides.map((side) => side.present)).toEqual([true, false, true])
  expect(detail.result.present).toBe(false)
  expect(await save(odd, { kind: 'text', text: 'kept\n' })).toMatchObject({ ok: true })
  expect(readFileSync(join(root, odd), 'utf8')).toBe('kept\n')
  // The literal pathspec staged only that file: `other` stays conflicted.
  expect(status()).toContain('UU other')
})

it('refuses a stale index or result and keeps the newer content', async () => {
  const { root, commit, read, save } = fixture()
  commit({ shared: 'base\n' }, 'Base')
  git(root, 'checkout', '-qb', 'feature')
  commit({ shared: 'feature\n' }, 'Feature')
  git(root, 'checkout', '-q', 'main')
  commit({ shared: 'main\n' }, 'Main')
  git(root, 'merge', 'feature')
  const first = await read('shared')
  writeFileSync(join(root, 'shared'), 'edited elsewhere\n')
  await expect(save('shared', { kind: 'text', text: 'mine\n' }, first.fingerprint)).rejects.toMatchObject({
    code: 'stale_conflict',
  })
  expect(readFileSync(join(root, 'shared'), 'utf8')).toBe('edited elsewhere\n')
  const second = await read('shared')
  git(root, 'add', 'shared')
  await expect(save('shared', { kind: 'text', text: 'mine\n' }, second.fingerprint)).rejects.toMatchObject({
    code: 'stale_conflict',
  })
  expect(readFileSync(join(root, 'shared'), 'utf8')).toBe('edited elsewhere\n')
})

it('reports a save followed by a staging failure as saved and retryable', async () => {
  const failing = fixture({ failAdd: true })
  failing.commit({ shared: 'base\n' }, 'Base')
  git(failing.root, 'checkout', '-qb', 'feature')
  failing.commit({ shared: 'feature\n' }, 'Feature')
  git(failing.root, 'checkout', '-q', 'main')
  failing.commit({ shared: 'main\n' }, 'Main')
  git(failing.root, 'merge', 'feature')
  const result = await failing.save('shared', { kind: 'text', text: 'both\n' })
  expect(result).toMatchObject({
    ok: false,
    saved: true,
    error: expect.stringContaining('index.lock'),
    state: { conflicts: [{ path: 'shared' }] },
  })
  expect(readFileSync(join(failing.root, 'shared'), 'utf8')).toBe('both\n')
  // The retry reads the saved result's new fingerprint first.
  expect((await failing.read('shared')).result.text).toBe('both\n')
})

it('refuses binary, oversized, symbolic link, and escaping paths with terminal guidance', async () => {
  const { root, commit, read, save } = fixture()
  const big = 'x'.repeat(CONFLICT_TEXT_BYTES + 1)
  commit({ bin: 'a\0', big: 'base\n', link: 'base\n' }, 'Base')
  git(root, 'checkout', '-qb', 'feature')
  commit({ bin: 'b\0', big: `${big}feature`, link: 'feature\n' }, 'Feature')
  git(root, 'checkout', '-q', 'main')
  commit({ bin: 'c\0', big: 'main\n', link: 'main\n' }, 'Main')
  git(root, 'merge', 'feature')
  expect((await read('bin')).unsupported).toMatch(/binary.*git checkout --ours/)
  expect((await read('big')).unsupported).toMatch(/larger than 512 KiB/)
  await expect(save('bin', { kind: 'text', text: 'x' })).rejects.toMatchObject({ code: 'unsupported_conflict' })
  rmSync(join(root, 'link'))
  symlinkSync(join(folder, 'outside'), join(root, 'link'))
  expect((await read('link')).unsupported).toMatch(/symbolic link/)
  await expect(read('../outside')).rejects.toMatchObject({ code: 'path_outside' })
  await expect(save('../outside', { kind: 'text', text: 'x' }, 'f'.repeat(64))).rejects.toMatchObject({
    code: 'path_outside',
  })
  expect(existsSync(join(folder, 'outside'))).toBe(false)
})

it('stops a cancelled read and writes nothing while the checkout is busy', async () => {
  const busy = fixture({ busy: true })
  busy.commit({ shared: 'base\n' }, 'Base')
  git(busy.root, 'checkout', '-qb', 'feature')
  busy.commit({ shared: 'feature\n' }, 'Feature')
  git(busy.root, 'checkout', '-q', 'main')
  busy.commit({ shared: 'main\n' }, 'Main')
  git(busy.root, 'merge', 'feature')
  await expect(busy.read('shared', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  const before = readFileSync(join(busy.root, 'shared'), 'utf8')
  await expect(busy.save('shared', { kind: 'text', text: 'both\n' })).rejects.toMatchObject({ code: 'checkout_busy' })
  expect(readFileSync(join(busy.root, 'shared'), 'utf8')).toBe(before)
  expect(busy.status()).toContain('UU shared')
})
