// Filesystem confinement. One canonical implementation, because there were four:
// taskWorktree.ts's resolveInRoot (lexical + symlink, the correct one), pathGuards.ts's
// isContainedPath (lexical only), plugins/agents' inputValidation.ts (its own realpath+relative pass),
// and plugins/editor's confine() wrapper.
//
// Only the lexical-and-symlink version is safe: a worktree holds arbitrary checked-out content,
// including a symlink an untrusted branch added that points at ~/.ssh. A lexical check passes that.
//
// NOT converged deliberately: plugins/docker/main/matcher.ts's isInside compares container labels
// (compose working_dir paths reported by the daemon), which are paths inside a container namespace.
// Resolving them against this host's filesystem would be wrong, not merely redundant — it is a
// matcher, not a guard.
import { existsSync, realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'

export { isContainedPath, isValidRepoIdent } from '../pathGuards'

// Confine a caller-supplied relative path to within `root`; null on any escape. Two gates: a lexical
// one (rejects `..`/absolute paths) and a symlink one — resolve the real path of the nearest EXISTING
// ancestor (the target itself may not exist yet on a new-file write) and require it to stay within
// root's real path.
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
// Returns a classified reason rather than throwing, so each caller keeps its own user-facing wording
// — which is why agents had its own copy in the first place.
export async function confineExistingFile(root: string, relPath: string): Promise<ConfineResult> {
  if (isAbsolute(relPath)) return { ok: false, reason: 'absolute' }
  const abs = resolveInRoot(root, relPath)
  if (!abs) return { ok: false, reason: 'escapes' }
  try {
    // realpathSync inside resolveInRoot only validated the nearest existing ANCESTOR. For a path that
    // must exist, resolve the target itself and re-check — a symlinked leaf is the interesting case.
    const real = realpathSync(abs)
    const realRoot = realpathSync(root)
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return { ok: false, reason: 'escapes' }
    if (!(await stat(real)).isFile()) return { ok: false, reason: 'not-file' }
    // `abs`, not `real`: on macOS the temp/worktree root often sits under a symlink (/var →
    // /private/var), so the realpath is correct but differently-rooted. Returning it would mean a
    // caller gets a string that no longer starts with the root it passed in — and would differ from
    // resolveInRoot for the same input. Both open the same file.
    return { ok: true, path: abs }
  } catch {
    return { ok: false, reason: 'missing' }
  }
}
