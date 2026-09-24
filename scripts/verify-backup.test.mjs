import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { assertBackupCompatible, verifyBackup } from './verify-backup.mjs'

const roots = []
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'acorn-backup-check-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('rejects old numeric-1 backups and roots without a baseline', () => {
  const current = { kind: 'acorn-backup', version: 1, baseline: 'acorn-1' }
  assert.throws(() => assertBackupCompatible({ kind: 'acorn-backup', version: 1 }, { baseline: 'acorn-1' }), /baseline/)
  assert.throws(() => assertBackupCompatible({ ...current, baseline: 'other' }, { baseline: 'acorn-1' }), /baseline/)
  assert.throws(() => assertBackupCompatible(current, { nodeId: 'old' }), /Target root/)
  assert.doesNotThrow(() => assertBackupCompatible(current, { baseline: 'acorn-1' }))
})

test('checks an archive against the initialized root without extracting files', () => {
  const root = fixture()
  const staging = join(root, 'staging')
  const target = join(root, 'target')
  mkdirSync(staging)
  mkdirSync(target)
  writeFileSync(join(staging, 'manifest.json'), JSON.stringify({ kind: 'acorn-backup', version: 1, baseline: 'acorn-1' }))
  writeFileSync(join(staging, 'core.sqlite'), 'opaque database bytes')
  writeFileSync(join(target, 'node.json'), JSON.stringify({ baseline: 'acorn-1', nodeId: 'fresh' }))
  const archive = join(root, 'backup.tar.gz')
  const tar = spawnSync('/usr/bin/tar', ['-czf', archive, '-C', staging, '.'], { encoding: 'utf8' })
  assert.equal(tar.status, 0, tar.stderr)
  assert.equal(verifyBackup(archive, target).baseline, 'acorn-1')
  assert.equal(readFileSync(join(target, 'node.json'), 'utf8').includes('fresh'), true)
  assert.throws(() => readFileSync(join(target, 'core.sqlite')), /ENOENT/)
  writeFileSync(join(target, 'node.json'), JSON.stringify({ nodeId: 'old' }))
  assert.throws(() => verifyBackup(archive, target), /Target root/)
})
