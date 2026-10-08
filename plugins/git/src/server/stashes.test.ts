import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CoreServices, TaskRef } from '@acorn/plugin-api/node'
import { applyStash, createStash, dropStash, stashRoster } from './stashes'

let folder = ''
afterEach(() => { if (folder) rmSync(folder, { recursive: true, force: true }); folder = '' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
function fixture() {
  folder = mkdtempSync(join(tmpdir(), 'acorn-stash-'))
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, '.gitignore'), 'ignored\n')
  writeFileSync(join(root, 'tracked'), 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Initial')
  const task: TaskRef = { id: 'task', title: 'Task', projectId: 'project', branch: null, worktreePath: null, skipSetup: false, pullNumber: null }
  const core = {
    projects: { byId: async (id: string) => id === 'project' ? { id, path: root } : null },
    tasks: { load: async (id: string) => id === task.id ? task : undefined, active: async () => [task] },
    checkoutAdmission: { write: async (_: string, action: (path: string) => Promise<unknown>) => action(root) },
    git: { git: async (args: readonly string[], opts: { cwd: string }) => new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
      const child = spawn('git', [...args], { cwd: opts.cwd })
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('close', (code) => done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    }) },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'tasks' | 'checkoutAdmission'>
  return { root, core }
}

it('creates tracked and untracked stashes, excludes ignored files, applies and pops', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'two\n')
  writeFileSync(join(root, 'untracked'), 'new\n')
  writeFileSync(join(root, 'ignored'), 'ignored\n')
  const created = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Tracked', includeUntracked: false, keepIndex: false })
  expect(created.ok).toBe(true)
  expect(readFileSync(join(root, 'tracked'), 'utf8')).toBe('one\n')
  expect(existsSync(join(root, 'untracked'))).toBe(true)
  const first = created.roster!.stashes[0]!
  expect(first.originBranch).toBeTruthy()
  rmSync(join(root, 'untracked'))
  const applied = await applyStash(core, 'project', { taskId: 'task', expectedPath: root, selection: first, restoreIndex: false }, false)
  expect(applied.ok).toBe(true)
  expect((await stashRoster(core, 'project')).stashes).toHaveLength(1)
  expect(readFileSync(join(root, 'tracked'), 'utf8')).toBe('two\n')
  git(root, 'stash', 'push', '-m', 'Reset for pop')
  const refreshed = (await stashRoster(core, 'project')).stashes.find((item) => item.objectId === first.objectId)!
  const popped = await applyStash(core, 'project', { taskId: 'task', expectedPath: root, selection: refreshed, restoreIndex: false }, true)
  expect(popped.ok).toBe(true)
  expect((await stashRoster(core, 'project')).stashes.some((item) => item.objectId === first.objectId)).toBe(false)
  git(root, 'reset', '--hard', 'HEAD')
  writeFileSync(join(root, 'untracked'), 'new\n')
  const untracked = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Untracked', includeUntracked: true, keepIndex: false })
  expect(untracked.ok).toBe(true)
  expect(untracked.roster!.stashes[0]!.untrackedFiles).toEqual(['untracked'])
  expect(existsSync(join(root, 'ignored'))).toBe(true)
  expect(existsSync(join(root, 'untracked'))).toBe(false)
})

it('refuses dirty targets, stale selectors and changed target paths', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'two\n')
  const made = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'First', includeUntracked: false, keepIndex: false })
  const first = made.roster!.stashes[0]!
  writeFileSync(join(root, 'tracked'), 'dirty\n')
  expect((await applyStash(core, 'project', { taskId: 'task', expectedPath: root, selection: first, restoreIndex: false }, false)).error).toMatch(/Target checkout has changes/)
  git(root, 'reset', '--hard', 'HEAD')
  writeFileSync(join(root, 'tracked'), 'three\n')
  await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Second', includeUntracked: false, keepIndex: false })
  await expect(dropStash(core, 'project', { selection: first, confirm: true })).rejects.toMatchObject({ code: 'stale_stash' })
  await expect(createStash(core, 'project', { taskId: 'task', expectedPath: '/wrong', message: 'No', includeUntracked: false, keepIndex: false })).rejects.toMatchObject({ code: 'checkout_moved' })
  await expect(createStash(core, 'project', { taskId: 'missing', expectedPath: root, message: 'No', includeUntracked: false, keepIndex: false })).rejects.toMatchObject({ code: 'task_missing' })
})

it('keeps staged changes when requested and refuses empty creation', async () => {
  const { root, core } = fixture()
  expect((await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Empty', includeUntracked: false, keepIndex: false })).ok).toBe(false)
  writeFileSync(join(root, 'tracked'), 'staged\n')
  git(root, 'add', 'tracked')
  writeFileSync(join(root, 'tracked'), 'unstaged\n')
  const made = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Keep index', includeUntracked: false, keepIndex: true })
  expect(made.ok).toBe(true)
  expect(git(root, 'show', ':tracked')).toBe('staged')
  git(root, 'reset', '--hard', 'HEAD')
  const restored = await applyStash(core, 'project', { taskId: 'task', expectedPath: root, selection: made.roster!.stashes[0]!, restoreIndex: true }, false)
  expect(restored.ok).toBe(true)
  expect(git(root, 'show', ':tracked')).toBe('staged')
})

it('retains a conflicting pop and reports the conflicted file', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'stash side\n')
  const made = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Conflict', includeUntracked: false, keepIndex: false })
  writeFileSync(join(root, 'tracked'), 'target side\n')
  git(root, 'add', 'tracked')
  git(root, 'commit', '-qm', 'Diverged')
  const popped = await applyStash(core, 'project', { taskId: 'task', expectedPath: root, selection: made.roster!.stashes[0]!, restoreIndex: false }, true)
  expect(popped.ok).toBe(false)
  expect(popped.conflicts).toContain('tracked')
  expect((await stashRoster(core, 'project')).stashes).toHaveLength(1)
})

it('distinguishes duplicate stash objects and refuses an externally moved selector', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'stash content\n')
  const made = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Original', includeUntracked: false, keepIndex: false })
  const original = made.roster!.stashes[0]!
  writeFileSync(join(root, 'tracked'), 'different stash\n')
  git(root, 'stash', 'push', '-m', 'Different')
  const different = git(root, 'rev-parse', 'refs/stash')
  git(root, 'update-ref', '-m', 'Duplicate', 'refs/stash', original.objectId, different)
  const duplicates = await stashRoster(core, 'project')
  expect(duplicates.stashes).toHaveLength(3)
  expect(new Set(duplicates.stashes.map((stash) => stash.id)).size).toBe(3)
  expect(duplicates.stashes[0]!.objectId).toBe(duplicates.stashes[2]!.objectId)
  await expect(dropStash(core, 'project', { selection: original, confirm: true })).rejects.toMatchObject({ code: 'stale_stash' })
  const removed = await dropStash(core, 'project', { selection: duplicates.stashes[2]!, confirm: true })
  expect(removed.ok).toBe(true)
  expect(removed.roster!.stashes).toHaveLength(2)
})
