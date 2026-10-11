import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { invalidateWorktreeStatus } from '@acorn/plugin-api/node'
import { changesEditorFileStatus } from './editorFileStatus'

const dirs: string[] = []
const fixture = () => { const dir = mkdtempSync(join(tmpdir(), 'acorn-editor-status-')); dirs.push(dir); return dir }
const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
afterEach(() => { for (const dir of dirs.splice(0)) { invalidateWorktreeStatus(dir); rmSync(dir, { recursive: true, force: true }) } })

it('reads only Git status for a task checkout and preserves the parser scopes', async () => {
  const dir = fixture()
  git(dir, 'init', '-q')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/a.ts'), 'before\n')
  writeFileSync(join(dir, 'src/gone.ts'), 'gone\n')
  git(dir, 'add', '.')
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base')
  writeFileSync(join(dir, 'src/a.ts'), 'staged\n')
  git(dir, 'add', 'src/a.ts')
  writeFileSync(join(dir, 'src/a.ts'), 'unstaged\n')
  git(dir, 'rm', '-q', 'src/gone.ts')
  writeFileSync(join(dir, 'src/added.ts'), 'added\n')
  git(dir, 'add', 'src/added.ts')
  writeFileSync(join(dir, 'src/new.ts'), 'new\n')
  const provider = changesEditorFileStatus({ tasks: { root: async () => dir } })
  const answer = await provider.read('task', { root: dir })
  expect(answer).toMatchObject({ kind: 'ready', changes: [
    { path: 'src/a.ts', status: 'modified', staged: true },
    { path: 'src/a.ts', status: 'modified', staged: false },
    { path: 'src/added.ts', status: 'added', staged: true },
    { path: 'src/gone.ts', status: 'deleted', staged: true },
    { path: 'src/new.ts', status: 'untracked', staged: false },
  ] })
  expect(await provider.read('task', { root: fixture() })).toEqual({ kind: 'unavailable' })
})

it('reports a plain non-Git directory without treating it as a transient failure', async () => {
  const dir = fixture()
  const provider = changesEditorFileStatus({ tasks: { root: async () => dir } })
  expect(await provider.read('task', { root: dir })).toEqual({ kind: 'not-git' })
})

it('reports a staged rename and an unresolved merge conflict from Git', async () => {
  const dir = fixture()
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'rename.txt'), 'rename\n')
  writeFileSync(join(dir, 'conflict.txt'), 'base\n')
  git(dir, 'add', '.')
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base')
  git(dir, 'checkout', '-qb', 'other')
  writeFileSync(join(dir, 'conflict.txt'), 'other\n')
  git(dir, 'add', 'conflict.txt')
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'other')
  git(dir, 'checkout', '-q', 'main')
  writeFileSync(join(dir, 'conflict.txt'), 'main\n')
  git(dir, 'add', 'conflict.txt')
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'main')
  try { git(dir, 'merge', '--no-commit', 'other') } catch { /* Git exits one for the expected conflict. */ }
  git(dir, 'mv', 'rename.txt', 'moved.txt')
  const provider = changesEditorFileStatus({ tasks: { root: async () => dir } })
  const answer = await provider.read('task', { root: dir })
  expect(answer).toMatchObject({ kind: 'ready' })
  if (answer.kind !== 'ready') throw new Error('Expected a Git checkout.')
  expect(answer.changes).toContainEqual({ path: 'moved.txt', oldPath: 'rename.txt', status: 'renamed', staged: true })
  expect(answer.changes).toContainEqual({ path: 'conflict.txt', status: 'conflicted', staged: false })
})
