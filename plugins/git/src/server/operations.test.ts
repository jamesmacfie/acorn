import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CompiledCoreServices, CoreServices, TaskRef } from '@acorn/plugin-api/node'
import { controlOperation, operationState, startOperation } from './operations'

let folder = ''
afterEach(() => { if (folder) rmSync(folder, { recursive: true, force: true }); folder = '' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, GIT_EDITOR: ':' } }).trim()

/** `main` and `feature` both change line one of `shared`; `side` adds an unrelated file. */
function fixture() {
  folder = mkdtempSync(join(tmpdir(), 'acorn-operation-'))
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, 'shared'), 'base\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Base')
  git(root, 'checkout', '-qb', 'feature')
  writeFileSync(join(root, 'shared'), 'feature\n')
  git(root, 'commit', '-qam', 'Feature')
  git(root, 'checkout', '-q', 'main')
  git(root, 'checkout', '-qb', 'side')
  writeFileSync(join(root, 'side'), 'side\n')
  git(root, 'add', 'side')
  git(root, 'commit', '-qm', 'Side')
  git(root, 'checkout', '-q', 'main')
  writeFileSync(join(root, 'shared'), 'main\n')
  git(root, 'commit', '-qam', 'Main')
  const task: TaskRef = { id: 'task', title: 'Task', projectId: 'project', branch: null, worktreePath: null, skipSetup: false, pullNumber: null }
  const busy: Array<{ taskId: string; description: string }> = []
  const core = {
    projects: { byId: async (id: string) => id === 'project' ? { id, path: root } : null },
    tasks: { load: async (id: string) => id === task.id ? task : undefined },
    checkoutAdmission: { write: async (_: string, action: (path: string) => Promise<unknown>) => action(root), activity: async () => busy },
    // An editor that always fails proves no command here stops at an editor prompt.
    git: { git: async (args: readonly string[], opts: { cwd: string; env?: Record<string, string> }) => new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
      const child = spawn('git', [...args], { cwd: opts.cwd, env: { ...process.env, GIT_EDITOR: 'false', GIT_TERMINAL_PROMPT: '0', ...opts.env } })
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('close', (code) => done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    }) },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'tasks'> & Pick<CompiledCoreServices, 'checkoutAdmission'>
  const id = (ref: string) => git(root, 'rev-parse', ref)
  const start = (operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert', source: string) =>
    startOperation(core, 'task', { expectedPath: root, expectedHead: id('HEAD'), operation, source })
  const control = (action: 'continue' | 'skip' | 'abort', operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert') =>
    controlOperation(core, 'task', action, { expectedPath: root, operation })
  return { root, core, busy, id, start, control }
}

it('merges, reports a no-op, and continues a resolved conflict without an editor', async () => {
  const { root, id, start, control } = fixture()
  expect(await start('merge', id('side'))).toMatchObject({ ok: true, error: null, state: { operation: null, conflicts: [] } })
  const merged = id('HEAD')
  expect(await start('merge', id('side'))).toMatchObject({ ok: true, state: { head: merged } })

  const conflicted = await start('merge', id('feature'))
  expect(conflicted).toMatchObject({ ok: false, state: { operation: 'merge', source: id('feature'), branch: 'main', conflicts: [{ path: 'shared', stages: [1, 2, 3] }] } })
  expect(conflicted.error).toContain('CONFLICT')
  await expect(control('continue', 'merge')).rejects.toMatchObject({ code: 'unresolved_conflicts' })
  await expect(control('skip', 'merge')).rejects.toMatchObject({ code: 'skip_unsupported' })

  writeFileSync(join(root, 'shared'), 'resolved\n')
  git(root, 'add', 'shared')
  expect(await control('continue', 'merge')).toMatchObject({ ok: true, state: { operation: null, conflicts: [] } })
  expect(git(root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3)
})

it('aborts a conflicted merge back to the starting commit', async () => {
  const { root, id, start, control } = fixture()
  const before = id('HEAD')
  await start('merge', id('feature'))
  expect(await control('abort', 'merge')).toMatchObject({ ok: true, state: { operation: null, head: before } })
  expect(readFileSync(join(root, 'shared'), 'utf8')).toBe('main\n')
})

it('rebases onto a pinned commit, skips a conflicted commit, and reads an external rebase', async () => {
  const { root, core, id, start, control } = fixture()
  git(root, 'checkout', '-q', 'feature')
  const stopped = await start('rebase', id('main'))
  expect(stopped).toMatchObject({ ok: false, state: { operation: 'rebase', source: id('main'), conflicts: [{ path: 'shared' }] } })
  expect(await control('skip', 'rebase')).toMatchObject({ ok: true, state: { operation: null, head: id('main') } })

  git(root, 'reset', '-q', '--hard', 'feature@{1}')
  expect(() => git(root, 'rebase', 'main')).toThrow()
  // A terminal rebase and a restarted Node read the same markers.
  expect(await operationState(core, 'task')).toMatchObject({ operation: 'rebase', source: id('main'), branch: null })
  expect(await control('abort', 'rebase')).toMatchObject({ ok: true, state: { operation: null, branch: 'feature' } })
})

it('continues a resolved cherry-pick and aborts a conflicted revert', async () => {
  const { root, id, start, control } = fixture()
  expect(await start('cherry-pick', id('feature'))).toMatchObject({ ok: false, state: { operation: 'cherry-pick', source: id('feature') } })
  writeFileSync(join(root, 'shared'), 'picked\n')
  git(root, 'add', 'shared')
  expect(await control('continue', 'cherry-pick')).toMatchObject({ ok: true, state: { operation: null } })
  expect(git(root, 'log', '-1', '--format=%s')).toBe('Feature')

  const before = id('HEAD')
  expect(await start('revert', id('main~1'))).toMatchObject({ ok: false, state: { operation: 'revert' } })
  expect(await control('abort', 'revert')).toMatchObject({ ok: true, state: { operation: null, head: before } })
})

it('refuses a dirty, moved, busy-looking, or already-operating checkout and a merge-commit pick', async () => {
  const { root, core, busy, id, start, control } = fixture()
  git(root, 'merge', '-q', '--no-edit', 'side')
  await expect(start('cherry-pick', id('HEAD'))).rejects.toMatchObject({ code: 'mainline_unsupported' })
  await expect(start('revert', id('HEAD'))).rejects.toMatchObject({ code: 'mainline_unsupported' })
  await expect(startOperation(core, 'task', { expectedPath: root, expectedHead: id('HEAD~1'), operation: 'merge', source: id('feature') }))
    .rejects.toMatchObject({ code: 'stale_head' })
  await expect(start('merge', 'f'.repeat(40))).rejects.toMatchObject({ code: 'source_missing' })

  writeFileSync(join(root, 'untracked'), 'new\n')
  await expect(start('merge', id('feature'))).rejects.toMatchObject({ code: 'dirty_checkout' })
  rmSync(join(root, 'untracked'))

  await start('merge', id('feature'))
  await expect(start('merge', id('side'))).rejects.toMatchObject({ code: 'operation_active' })
  await expect(control('continue', 'rebase')).rejects.toMatchObject({ code: 'stale_operation' })

  busy.push({ taskId: 'other', description: 'queued turn' })
  expect((await operationState(core, 'task')).busy).toEqual(['other queued turn'])
})

it('reports a conflicted stash as unresolved paths with nothing to continue', async () => {
  const { root, core, control } = fixture()
  writeFileSync(join(root, 'shared'), 'stashed\n')
  git(root, 'stash', 'push', '-qm', 'Conflicting')
  writeFileSync(join(root, 'shared'), 'committed\n')
  git(root, 'commit', '-qam', 'Committed')
  expect(() => git(root, 'stash', 'apply')).toThrow()
  expect(await operationState(core, 'task')).toMatchObject({ operation: null, conflicts: [{ path: 'shared', stages: [1, 2, 3] }] })
  await expect(control('continue', 'merge')).rejects.toMatchObject({ code: 'stale_operation' })
  await expect(control('abort', 'merge')).rejects.toMatchObject({ code: 'stale_operation' })
})
