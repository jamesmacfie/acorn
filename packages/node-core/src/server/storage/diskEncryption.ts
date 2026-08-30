import { runProcess } from '../core/proc'

// Is this machine's disk encrypted? Application encryption covers secrets and backup archives only.
// Worktrees, the blob cache, and plugin databases hold source, patches, and agent transcripts that
// nothing but the operating system protects.
//
// `null` is a real answer, not a failure. On Linux the honest report is "we do not know", since
// LUKS, dm-crypt, ZFS native encryption, and a dozen NAS arrangements all count, and a bad probe
// would give a confident wrong answer.

export type DiskEncryption = boolean | null

// `fdesetup isactive` prints `true` or `false` and exits 0 or 1 to match. Not `fdesetup status`,
// which prints prose whose wording has changed across macOS releases, so parsing it starts returning
// the wrong answer after an OS upgrade.
//
// It runs through the process broker rather than a bare execFile (docs/security.md § Process, path,
// and configuration controls), for the allowlisted environment and a bounded capture instead of
// inheriting this process's environment, tokens included.
async function probe(): Promise<DiskEncryption> {
  if (process.platform !== 'darwin') return null
  try {
    const result = await runProcess({
      file: '/usr/bin/fdesetup',
      args: ['isactive'],
      cwd: '/',
      timeoutMs: 5_000,
    })
    // A missing binary, a timeout, or anything unrecognised is `null`, not `false`. Reporting "your
    // disk is not encrypted" because a probe failed teaches the owner to dismiss a warning that matters.
    if (result.spawnError || result.timedOut) return null
    const answer = result.stdout.trim().toLowerCase()
    if (answer === 'true') return true
    if (answer === 'false') return false
    return null
  } catch {
    return null
  }
}

// Cached for the life of the process. Turning FileVault on needs a reboot on macOS, so the answer
// cannot change under a running node, and a probe per settings-page open spawns a process for
// nothing.
let cached: Promise<DiskEncryption> | null = null

export function diskEncryption(): Promise<DiskEncryption> {
  cached ??= probe()
  return cached
}

// Test seam. The probe is a real subprocess, so a case that wants a known answer sets one here, and
// a case that wants the real answer clears it.
export function _setDiskEncryption(value: Promise<DiskEncryption> | null): void {
  cached = value
}
