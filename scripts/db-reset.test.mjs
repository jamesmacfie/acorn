import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { runReset } from './reset/run.mjs'

const fixtures = []
const fixture = () => { const root = mkdtempSync(join(realpathSync(tmpdir()), 'acorn-reset-test-')); fixtures.push(root); return root }
const put = (path, body) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body) }
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('dry run lists exact files and leaves repositories, worktrees and external configuration untouched', () => {
  const base = fixture(), node = join(base, 'node'), tui = join(base, 'tui')
  mkdirSync(node); mkdirSync(tui)
  put(join(node, 'core.sqlite'), 'db')
  put(join(node, 'core.sqlite-wal'), 'wal')
  put(join(node, 'core.sqlite-shm'), 'shm')
  put(join(node, 'plugins', 'notes.sqlite'), 'plugin')
  put(join(node, 'worktrees', 'task', 'source.ts'), 'source')
  put(join(node, '.env'), 'EXTERNAL_DATABASE_URL=example')
  put(join(node, 'arbitrary.txt'), 'keep')
  put(join(tui, 'cache', 'node.json'), 'cache')
  const result = runReset({ nodeRoot: node, tuiRoot: tui })
  assert.equal(result.mode, 'inventory')
  assert.deepEqual(result.files.map(file => file.path), [join(node, 'core.sqlite'), join(node, 'core.sqlite-shm'), join(node, 'core.sqlite-wal'), join(node, 'plugins', 'notes.sqlite'), join(tui, 'cache', 'node.json')].sort())
  assert.deepEqual(result.files.find(file => file.path === join(node, 'core.sqlite')).owners, ['node'])
  assert.deepEqual(result.files.find(file => file.path === join(tui, 'cache', 'node.json')).owners, ['tui'])
  assert.equal(readFileSync(join(node, 'worktrees', 'task', 'source.ts'), 'utf8'), 'source')
  assert.equal(readFileSync(join(node, '.env'), 'utf8'), 'EXTERNAL_DATABASE_URL=example')
  assert.equal(readFileSync(join(node, 'arbitrary.txt'), 'utf8'), 'keep')
  assert.deepEqual(readdirSync(base).sort(), ['node', 'tui'])
})

test('exports verified private files, removes only inventory and restores into isolated roots', () => {
  const base = fixture(), node = join(base, 'node'), recoveryDir = join(base, 'recovery'), restored = join(base, 'restored')
  mkdirSync(node); mkdirSync(restored)
  const files = ['core.sqlite', 'core.sqlite-wal', 'core.sqlite-shm', 'plugins/agents.sqlite', 'notes/note.md']
  for (const file of files) put(join(node, file), file)
  put(join(node, 'worktrees', 'task', 'source.ts'), 'source')
  const result = runReset({ execute: true, nodeRoot: node, recoveryDir })
  assert.equal(result.complete, true)
  const manifest = JSON.parse(readFileSync(join(recoveryDir, 'manifest.json'), 'utf8'))
  assert.equal(statSync(recoveryDir).mode & 0o777, 0o700)
  assert.equal(statSync(join(recoveryDir, 'manifest.json')).mode & 0o777, 0o600)
  for (const item of manifest.files) {
    const saved = join(recoveryDir, item.recoveryFile)
    assert.equal(hash(saved), item.sha256)
    assert.equal(item.status, 'removed')
    assert.equal(existsSync(item.path), false)
    const relative = item.path.slice(node.length + 1)
    put(join(restored, relative), readFileSync(saved))
    assert.equal(hash(join(restored, relative)), item.sha256)
  }
  assert.equal(existsSync(join(node, 'plugins')), false)
  assert.equal(existsSync(join(node, 'notes')), false)
  assert.equal(readFileSync(join(node, 'worktrees', 'task', 'source.ts'), 'utf8'), 'source')
  assert.equal(runReset({ execute: true, nodeRoot: node, recoveryDir }).complete, true)
})

test('resumes interrupted export and removal from the same manifest', () => {
  const base = fixture(), node = join(base, 'node'), recoveryDir = join(base, 'recovery')
  mkdirSync(node)
  put(join(node, 'core.sqlite'), 'a')
  put(join(node, 'node.json'), 'b')
  assert.throws(() => runReset({ execute: true, nodeRoot: node, recoveryDir }, { afterExport: () => { throw new Error('stop export') } }), /stop export/)
  assert.equal(existsSync(join(node, 'core.sqlite')), true)
  assert.throws(() => runReset({ execute: true, nodeRoot: node, recoveryDir }, { afterRemoval: () => { throw new Error('stop removal') } }), /stop removal/)
  assert.equal(runReset({ execute: true, nodeRoot: node, recoveryDir }).complete, true)
})

test('resumes after removing an owned directory', () => {
  const base = fixture(), node = join(base, 'node'), recoveryDir = join(base, 'recovery')
  mkdirSync(node)
  put(join(node, 'plugins', 'notes.sqlite'), 'db')
  assert.throws(() => runReset({ execute: true, nodeRoot: node, recoveryDir }, { afterDirectoryRemoval: () => { throw new Error('stop directory') } }), /stop directory/)
  assert.equal(runReset({ execute: true, nodeRoot: node, recoveryDir }).complete, true)
  assert.equal(existsSync(join(node, 'plugins')), false)
})

test('refuses live locks, symlinks, protected and ambiguous paths', () => {
  const base = fixture(), node = join(base, 'node'), outside = join(base, 'outside')
  mkdirSync(node); mkdirSync(outside)
  put(join(node, 'node.lock'), `${process.pid}\n`)
  assert.throws(() => runReset({ nodeRoot: node }), /Live node/)
  rmSync(join(node, 'node.lock'))
  symlinkSync(outside, join(node, 'plugins'))
  assert.throws(() => runReset({ nodeRoot: node }), /Symlink/)
  unlinkSync(join(node, 'plugins'))
  put(join(node, 'core.sqlite'), 'db')
  assert.throws(() => runReset({ execute: true, nodeRoot: node, recoveryDir: join(node, 'recovery') }), /overlaps/)
  assert.throws(() => runReset({ nodeRoot: node, tuiRoot: node }), /Overlapping|reset root/)
  assert.throws(() => runReset({ execute: true, nodeRoot: node }), /recovery-dir/)
})

test('shared device roots are inventoried once and desktop host state blocks mutation', () => {
  const base = fixture(), node = join(base, 'node'), shell = join(node, 'shell'), recoveryDir = join(base, 'recovery')
  mkdirSync(shell, { recursive: true })
  put(join(node, 'core.sqlite'), 'db')
  put(join(shell, 'fleet.json'), 'fleet')
  put(join(shell, 'device-token-local'), 'encrypted')
  const result = runReset({ nodeRoot: node, desktopRoot: shell, tuiRoot: shell })
  assert.equal(result.files.filter(file => file.path === join(shell, 'fleet.json')).length, 1)
  assert.throws(() => runReset({ execute: true, nodeRoot: node, desktopRoot: shell, tuiRoot: shell, recoveryDir }), /host stage is missing/)
  assert.equal(readFileSync(join(shell, 'fleet.json'), 'utf8'), 'fleet')
  assert.equal(existsSync(recoveryDir), false)
})

test('desktop files wait for an exact, checksummed private host stage', () => {
  const base = fixture(), node = join(base, 'node'), shell = join(node, 'shell'), recoveryDir = join(base, 'recovery')
  mkdirSync(shell, { recursive: true }); mkdirSync(recoveryDir, { mode: 0o700 })
  put(join(node, 'core.sqlite'), 'db')
  put(join(shell, 'fleet.json'), 'fleet')
  put(join(shell, 'device-token-local'), 'encrypted')
  put(join(recoveryDir, 'desktop-origin.json'), '{}')
  chmodSync(join(recoveryDir, 'desktop-origin.json'), 0o600)
  put(join(recoveryDir, 'desktop-key.txt'), 'a'.repeat(64))
  chmodSync(join(recoveryDir, 'desktop-key.txt'), 0o600)
  const stage = { desktopRoot: shell, files: [
    { path: 'desktop-origin.json', sha256: hash(join(recoveryDir, 'desktop-origin.json')) },
    { path: 'desktop-key.txt', sha256: hash(join(recoveryDir, 'desktop-key.txt')) },
  ], complete: true }
  put(join(recoveryDir, 'desktop-stage.json'), JSON.stringify(stage))
  chmodSync(join(recoveryDir, 'desktop-stage.json'), 0o600)
  assert.equal(runReset({ execute: true, nodeRoot: node, desktopRoot: shell, recoveryDir }).complete, true)
  assert.equal(existsSync(join(shell, 'fleet.json')), false)
  assert.equal(readFileSync(join(recoveryDir, 'desktop-origin.json'), 'utf8'), '{}')
  assert.equal(runReset({ execute: true, nodeRoot: node, desktopRoot: shell, recoveryDir }).complete, true)
})

test('refuses open files and unsafe recovery permissions without removing sources', () => {
  const base = fixture(), node = join(base, 'node'), recoveryDir = join(base, 'recovery')
  mkdirSync(node)
  put(join(node, 'core.sqlite'), 'db')
  const fd = openSync(join(node, 'core.sqlite'), 'r')
  try { assert.throws(() => runReset({ execute: true, nodeRoot: node, recoveryDir }), /Open reset target/) }
  finally { closeSync(fd) }
  mkdirSync(recoveryDir)
  chmodSync(recoveryDir, 0o755)
  assert.throws(() => runReset({ execute: true, nodeRoot: node, recoveryDir }), /private/)
  assert.equal(readFileSync(join(node, 'core.sqlite'), 'utf8'), 'db')
})
