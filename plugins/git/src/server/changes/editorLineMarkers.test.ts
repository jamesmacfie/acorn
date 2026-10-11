import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { git, type CoreServices } from '@acorn/plugin-api/node'
import { uncommittedEditorLineMarkers } from './editorLineMarkers'

let root: string
let core: Pick<CoreServices, 'tasks' | 'git'>
const setup = (...args: string[]) => execFileSync('git', args, { cwd: root })
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-local-markers-'))
  setup('init', '-q')
  setup('config', 'user.name', 'Fixture')
  setup('config', 'user.email', 'fixture@example.test')
  setup('config', 'commit.gpgsign', 'false')
  core = { tasks: { root: async () => root }, git: { git } } as unknown as typeof core
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('preserves unborn, untracked, staged, and unstaged ranges for literal filenames', async () => {
  const provider = uncommittedEditorLineMarkers(core)
  const path = 'file[0].txt'
  writeFileSync(join(root, path), 'first\nsecond\n')
  expect(await provider.read('task', path, { root })).toEqual([{ from: 1, to: 2 }])
  setup('add', '.')
  setup('commit', '-qm', 'base')
  writeFileSync(join(root, path), 'changed\nsecond\n')
  setup('add', '.')
  writeFileSync(join(root, path), 'changed\nsecond\nunstaged\n')
  writeFileSync(join(root, 'file0.txt'), 'untracked\n')
  expect(await provider.read('task', path, { root })).toEqual([{ from: 1, to: 1 }, { from: 3, to: 3 }])
  expect(await provider.read('task', 'file0.txt')).toEqual([{ from: 1, to: 1 }])
  await expect(provider.read('task', path, { root: '/different-root' })).rejects.toThrow('worktree changed')
})

it('rejects a failed or truncated diff instead of publishing an empty clean set', async () => {
  const execute = core.git.git
  core.git.git = async (args, options) => {
    const result = await execute(args, options)
    return args[0] === 'diff' ? { ...result, code: 2, stdout: '', stderr: 'failed' } : result
  }
  await expect(uncommittedEditorLineMarkers(core).read('task', 'missing.txt')).rejects.toThrow('unavailable')
  core.git.git = async (args, options) => {
    const result = await execute(args, options)
    return args[0] === 'diff' ? { ...result, code: 1, stdout: '@@ -0,0 +1 @@', stderr: '', truncated: true } : result
  }
  await expect(uncommittedEditorLineMarkers(core).read('task', 'missing.txt')).rejects.toThrow('unavailable')
})
