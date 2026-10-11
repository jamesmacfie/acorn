// Filesystem confinement: one canonical implementation (docs/security/process-and-paths.md § Process, path, and
// configuration controls). resolveInRoot is lexical and symlink aware; a lexical-only check lets a
// worktree symlink escape its root.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'

export { isContainedPath, isValidRepoIdent } from '../worktrees/pathGuards'

// Confine a caller-supplied relative path to within `root`, returning null on any escape. Two gates:
// a lexical one that rejects `..` and absolute paths, and a symlink one that resolves the real path
// of the nearest existing ancestor and requires it to stay within root's real path. It checks the
// ancestor because the target may not exist yet on a new-file write.
export function resolveInRoot(root: string, relPath: string): string | null {
  if (isAbsolute(relPath)) return null
  root = resolve(root)
  const abs = resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + sep)) return null
  try {
    const realRoot = realpathSync(root)
    let probe = abs
    // lstat sees a dangling symlink as an existing entry. Skipping it with existsSync would
    // approve its parent, then let a new-file write follow the link out of the root.
    while (probe !== root) {
      try {
        lstatSync(probe)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
        probe = dirname(probe)
      }
    }
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
    // Return `abs`, not `real`. On macOS the worktree root often sits under a symlink such as /var
    // to /private/var, so `real` is correct but differently rooted: it would no longer start with
    // the root the caller passed in, and would disagree with resolveInRoot on the same input. Both
    // open the same file.
    return { ok: true, path: abs }
  } catch {
    return { ok: false, reason: 'missing' }
  }
}

// A repository can commit any bytes it likes into a TOML file Acorn parses on the event loop, so a
// configuration read stops at this size rather than handing the parser an unbounded document.
export const MAX_CONFIG_FILE_BYTES = 1024 * 1024

// Read a configuration file of at most MAX_CONFIG_FILE_BYTES. O_NONBLOCK and the regular-file check
// keep a FIFO from blocking the open. Symlinks are followed, as a plain read would follow them, so a
// person's dotfile link keeps working; confining the path is the caller's job.
export function readConfigFileSync(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error(`${path} is not a regular file.`)
    const tooLarge = () =>
      new Error(`${path} is larger than the ${MAX_CONFIG_FILE_BYTES}-byte limit for configuration files.`)
    if (stat.size > MAX_CONFIG_FILE_BYTES) throw tooLarge()
    // Count what is actually read too: the file can grow after the stat.
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_CONFIG_FILE_BYTES - total + 1))
      const count = readSync(fd, chunk, 0, chunk.length, null)
      if (!count) break
      total += count
      if (total > MAX_CONFIG_FILE_BYTES) throw tooLarge()
      chunks.push(chunk.subarray(0, count))
    }
    return Buffer.concat(chunks, total).toString('utf8')
  } finally {
    closeSync(fd)
  }
}
