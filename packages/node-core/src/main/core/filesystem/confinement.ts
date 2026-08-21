// Filesystem confinement: one canonical implementation (docs/security.md § Process, path, and
// configuration controls). resolveInRoot is lexical and symlink aware; a lexical-only check lets a
// worktree symlink escape its root.
import { existsSync, realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'

export { isContainedPath, isValidRepoIdent } from '../../pathGuards'

// Confine a caller-supplied relative path to within `root`; null on any escape. Two gates: a
// lexical one that rejects `..` and absolute paths, and a symlink one that resolves the real path of
// the nearest existing ancestor (the target itself may not exist yet on a new-file write) and
// requires it to stay within root's real path.
export function resolveInRoot(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + sep)) return null
  try {
    const realRoot = realpathSync(root)
    let probe = abs
    while (probe !== root && !existsSync(probe)) probe = dirname(probe)
    const real = realpathSync(probe)
    return real === realRoot || real.startsWith(realRoot + sep) ? abs : null
  } catch {
    return null
  }
}

export type ConfineFailure = 'absolute' | 'escapes' | 'missing' | 'not-file'
export type ConfineResult = { ok: true; path: string } | { ok: false; reason: ConfineFailure }

// The variant for a path that must already exist and be a regular file (agent file mentions).
// Returns a classified reason rather than throwing, so each caller keeps its own user-facing
// wording.
export async function confineExistingFile(root: string, relPath: string): Promise<ConfineResult> {
  if (isAbsolute(relPath)) return { ok: false, reason: 'absolute' }
  const abs = resolveInRoot(root, relPath)
  if (!abs) return { ok: false, reason: 'escapes' }
  try {
    // resolveInRoot only validates the nearest existing ancestor. For a path that must exist,
    // resolve the target itself and check again: a symlinked leaf is the case that matters here.
    const real = realpathSync(abs)
    const realRoot = realpathSync(root)
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return { ok: false, reason: 'escapes' }
    if (!(await stat(real)).isFile()) return { ok: false, reason: 'not-file' }
    // Returns `abs`, not `real`. On macOS the temp/worktree root often sits under a symlink
    // (/var -> /private/var), so the realpath is correct but differently rooted: returning it would
    // hand the caller a string that no longer starts with the root it passed in, and would differ
    // from resolveInRoot's answer for the same input. Both open the same file.
    return { ok: true, path: abs }
  } catch {
    return { ok: false, reason: 'missing' }
  }
}
