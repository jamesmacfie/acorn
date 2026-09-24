#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ACORN_BASELINE } from '../packages/protocol/src/baseline.ts'

export function assertBackupCompatible(manifest, identity) {
  if (manifest?.kind !== 'acorn-backup' || manifest.version !== 1 || manifest.baseline !== ACORN_BASELINE) {
    throw new Error(`Backup has no matching ${ACORN_BASELINE} baseline; restore refused.`)
  }
  if (identity?.baseline !== ACORN_BASELINE) {
    throw new Error(`Target root has no matching ${ACORN_BASELINE} baseline; restore refused.`)
  }
}

/** Read only the archive manifest and target identity. No archive member is extracted. */
export function verifyBackup(archive, targetRoot) {
  const result = spawnSync('/usr/bin/tar', ['-xOzf', archive, './manifest.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`Could not read backup manifest: ${result.error?.message ?? result.stderr.trim()}`)
  let manifest
  let identity
  try { manifest = JSON.parse(result.stdout) } catch { throw new Error('Backup manifest is not JSON; restore refused.') }
  try { identity = JSON.parse(readFileSync(join(targetRoot, 'node.json'), 'utf8')) } catch { throw new Error('Target root has no readable node.json; initialize the fresh root first.') }
  assertBackupCompatible(manifest, identity)
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , archive, targetRoot] = process.argv
  if (!archive || !targetRoot) {
    console.error('Usage: pnpm backup:verify <backup.tar.gz> <initialized-target-root>')
    process.exitCode = 2
  } else {
    try {
      verifyBackup(archive, targetRoot)
      console.log('Backup and target root use the acorn-1 baseline.')
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
