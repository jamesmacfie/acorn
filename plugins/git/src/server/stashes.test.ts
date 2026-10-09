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
function fixture(objectFormat?: 'sha256') {
  folder = mkdtempSync(join(tmpdir(), 'acorn-stash-'))
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q', ...(objectFormat ? ['--object-format=sha256'] : []))
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, '.gitignore'), 'ignored\n')
  writeFileSync(join(root, 'tracked'), 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Initial')
  const task: TaskRef = { id: 'task', title: 'Task', projectId: 'project', branch: null, worktreePath: null, skipSetup: false, pullNumber: null }
  const core = {
    projects: { byId: async (id: string) => id === 'project' ? { id, path: root } : null },
    tasks: { load: async (id: string) => id === task.id ? task : undefined, active: async () => [task], branchClaims: async () => [task] },
    checkoutAdmission: { write: async (_: string, action: (path: string) => Promise<unknown>) => action(task.worktreePath ?? root) },
    git: { git: async (args: readonly string[], opts: { cwd: string }) => new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
      const child = spawn('git', [...args], { cwd: opts.cwd })
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('close', (code) => done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    }) },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'tasks' | 'checkoutAdmission'>
  return { root, core, task }
}

it('refuses a recorded checkout replaced with an independent repository', async () => {
  const { root, core, task } = fixture()
  const linked = join(folder, 'linked')
  git(root, 'worktree', 'add', '-q', '-b', 'linked', linked)
  task.branch = 'linked'
  task.worktreePath = linked
  git(root, 'worktree', 'remove', linked)
  mkdirSync(linked)
  git(linked, 'init', '-q')
  git(linked, 'config', 'user.name', 'Acorn Test')
  git(linked, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(linked, 'tracked'), 'independent\n')
  git(linked, 'add', 'tracked')
  git(linked, 'commit', '-qm', 'Independent')
  writeFileSync(join(linked, 'tracked'), 'uncommitted\n')
  await expect(createStash(core, 'project', { taskId: 'task', expectedPath: linked, message: 'Wrong repo', includeUntracked: false, keepIndex: false }))
    .rejects.toMatchObject({ code: 'wrong_repository' })
  expect(readFileSync(join(linked, 'tracked'), 'utf8')).toBe('uncommitted\n')
  expect(git(linked, 'stash', 'list')).toBe('')
  expect(git(root, 'stash', 'list')).toBe('')
})

it('reads all parents of an include-untracked SHA-256 stash when Git supports it', async () => {
  let fixtureResult: ReturnType<typeof fixture>
  try { fixtureResult = fixture('sha256') }
  catch (error) {
    if (String(error).includes('unknown option') || String(error).includes('unsupported')) return
    throw error
  }
  const { root, core } = fixtureResult
  writeFileSync(join(root, 'tracked'), 'changed\n')
  writeFileSync(join(root, 'untracked'), 'captured\n')
  const made = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'SHA-256', includeUntracked: true, keepIndex: false })
  expect(made.ok).toBe(true)
  expect(made.roster!.stashes[0]!.objectId).toHaveLength(64)
  expect(made.roster!.stashes[0]!.untrackedParent).toHaveLength(64)
  expect(made.roster!.stashes[0]!.untrackedFiles).toEqual(['untracked'])
})

it('stops detail subprocesses when a roster request is abandoned', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'changed\n')
  await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Cancel read', includeUntracked: false, keepIndex: false })
  const controller = new AbortController()
  const underlying = core.git.git
  const calls: string[] = []
  core.git.git = async (args, opts) => {
    calls.push(args[0]!)
    const response = await underlying(args, opts)
    if (args[0] === 'rev-list') controller.abort()
    return response
  }
  await expect(stashRoster(core, 'project', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(calls.filter((name) => name === 'rev-list')).toHaveLength(1)
  expect(calls).not.toContain('ls-tree')
})

it('refuses an unreadable Git operation marker instead of treating it as absent', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'changed\n')
  const underlying = core.git.git
  core.git.git = async (args, opts) => args.includes('--git-path') && args.includes('MERGE_HEAD')
    ? { ...await underlying(args, opts), stdout: '/dev/null/unreadable\n' }
    : underlying(args, opts)
  await expect(createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Refuse', includeUntracked: false, keepIndex: false }))
    .rejects.toMatchObject({ code: 'operation_unavailable' })
  expect(git(root, 'stash', 'list')).toBe('')
})

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

it('reports unknown conflict state and an observed partial checkout change', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'stashed\n')
  const made = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Partial', includeUntracked: false, keepIndex: false })
  const underlying = core.git.git
  core.git.git = async (args, opts) => args[0] === 'diff' && args.includes('--diff-filter=U')
    ? { ...await underlying(args, opts), code: 1, stderr: 'probe failed' }
    : underlying(args, opts)
  const applied = await applyStash(core, 'project', { taskId: 'task', expectedPath: root, selection: made.roster!.stashes[0]!, restoreIndex: false }, false)
  expect(applied).toMatchObject({ ok: false, changed: true, conflicts: null })
  expect(applied.error).toMatch(/Conflict state unavailable/)
  expect(readFileSync(join(root, 'tracked'), 'utf8')).toBe('stashed\n')
})

it('keeps a partial result when a command changes files but post-command roster read fails', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'stashed\n')
  const underlying = core.git.git
  let pushed = false
  core.git.git = async (args, opts) => {
    if (args[0] === 'stash' && args[1] === 'push') { const response = await underlying(args, opts); pushed = true; return response }
    if (pushed && args[0] === 'stash' && args[1] === 'list') return { ...await underlying(args, opts), code: 1, stderr: 'roster unavailable' }
    return underlying(args, opts)
  }
  const made = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Partial', includeUntracked: false, keepIndex: false })
  expect(made).toMatchObject({ ok: false, changed: true, roster: null })
  expect(made.error).toMatch(/Stash roster unavailable/)
  expect(readFileSync(join(root, 'tracked'), 'utf8')).toBe('one\n')
  expect(git(root, 'stash', 'list')).toContain('Partial')
})

it('keeps an observed partial result when a Git command reports an exception after writing', async () => {
  const { root, core } = fixture()
  writeFileSync(join(root, 'tracked'), 'stashed\n')
  const underlying = core.git.git
  core.git.git = async (args, opts) => {
    const response = await underlying(args, opts)
    if (args[0] === 'stash' && args[1] === 'push') throw new Error('transport failed after command')
    return response
  }
  const made = await createStash(core, 'project', { taskId: 'task', expectedPath: root, message: 'Thrown', includeUntracked: false, keepIndex: false })
  expect(made).toMatchObject({ ok: false, changed: true, conflicts: [], roster: { stashes: [{ message: expect.stringContaining('Thrown') }] } })
  expect(made.error).toMatch(/may have changed repository data/)
  expect(readFileSync(join(root, 'tracked'), 'utf8')).toBe('one\n')
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
  // A selected duplicate must disappear from navigation when the reflog order changes.
  const oldDuplicateId = duplicates.stashes[2]!.id
  git(root, 'stash', 'drop', 'stash@{1}')
  const shifted = await stashRoster(core, 'project')
  expect(shifted.stashes.find((entry) => entry.id === oldDuplicateId)).toBeUndefined()
  await expect(dropStash(core, 'project', { selection: original, confirm: true })).rejects.toMatchObject({ code: 'stale_stash' })
  const removed = await dropStash(core, 'project', { selection: shifted.stashes[1]!, confirm: true })
  expect(removed.ok).toBe(true)
  expect(removed.roster!.stashes).toHaveLength(1)
})
