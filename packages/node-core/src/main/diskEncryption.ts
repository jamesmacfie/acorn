import { runProcess } from './core/proc'

// Is this machine's disk encrypted? (docs/vNext/security.md § On-disk: "Worktrees, mirrors, caches,
// scrollback rely on OS full-disk encryption; the app warns once if the disk isn't encrypted".)
//
// It matters because of what application encryption deliberately does NOT cover. Only secrets and backup
// archives are encrypted by acorn; a node's worktrees hold the owner's source, its blob cache holds every
// patch it has fetched, its plugin databases hold agent transcripts, and none of that is protected by
// anything but the operating system. On a machine without FileVault, "someone who steals the laptop" —
// which security.md's threat model otherwise leaves to the OS — reads all of it.
//
// Three answers, and `null` is a real one rather than a failure: on Linux the honest report is "we do not
// know" (LUKS, dm-crypt, ZFS native encryption and a dozen NAS arrangements all count, and probing for
// them badly would produce a confident wrong answer, which is worse than none for a security warning).

export type DiskEncryption = boolean | null

// `fdesetup isactive` prints `true`/`false` and exits 0/1 accordingly. Deliberately not `fdesetup status`:
// that prints prose which has changed wording across macOS releases, and parsing it is how a check like
// this quietly starts returning the wrong answer after an OS upgrade.
//
// Through the process broker rather than a bare execFile, per CLAUDE.md § Process ownership — which also
// means it runs with the allowlisted environment and a bounded capture rather than inheriting this
// process's env, tokens included.
async function probe(): Promise<DiskEncryption> {
  if (process.platform !== 'darwin') return null
  try {
    const result = await runProcess({
      file: '/usr/bin/fdesetup',
      args: ['isactive'],
      cwd: '/',
      timeoutMs: 5_000,
    })
    // A missing binary, a timeout, or anything unrecognised is `null`, not `false`. Reporting "your disk
    // is not encrypted" because a probe failed would train the owner to dismiss a warning that matters.
    if (result.spawnError || result.timedOut) return null
    const answer = result.stdout.trim().toLowerCase()
    if (answer === 'true') return true
    if (answer === 'false') return false
    return null
  } catch {
    return null
  }
}

// Cached for the life of the process. Turning FileVault on requires a reboot on macOS, so a node that has
// been running since before the change is going to be restarted anyway — and a check on every settings
// page open would spawn a process for an answer that cannot have changed.
let cached: Promise<DiskEncryption> | null = null

export function diskEncryption(): Promise<DiskEncryption> {
  cached ??= probe()
  return cached
}

// Test seam. The probe is a real subprocess, so a case that wants a known answer has to be able to say so
// without one; a case that wants the real answer clears it.
export function _setDiskEncryption(value: Promise<DiskEncryption> | null): void {
  cached = value
}
