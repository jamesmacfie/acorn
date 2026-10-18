// The login-shell PATH probe, and the gate that makes it safe to run it off the critical path.
//
// On a packaged macOS build a GUI-launched process inherits a minimal PATH, so the node asks the
// owner's login shell what theirs is. That costs half a second to two seconds on a profile with a
// version manager in it, and the answer is only needed to spawn agents and build commands — not to
// migrate a database or bind a listener. So the boot starts the probe and moves on. The last good
// answer is kept in the data root, so a launch that has one uses it at once and nothing waits; only a
// launch without one, or after the owner changed shell, holds the first spawn until the probe settles.
//
// See docs/node-distribution.md § Boot order, and core/proc.ts for the one place that waits.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writePrivateAtomic } from '../storage/dataRoot'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('service:boot')

// Long enough for a slow profile, short enough that a broken shell cannot wedge the first spawn
// forever.
const PROBE_TIMEOUT_MS = 5_000

// Beside node.json. It names the owner's folders, so it is written mode 0600 and never leaves the
// machine (docs/data-layer/data-root.md § Where it lives).
const CACHE_FILE = 'login-shell-path.json'

let pending: Promise<unknown> | null = null

/** Start the probe, and hold spawns on it unless the data root has the last launch's answer for this
 *  shell. Answers the probe, which never rejects, so the boot can time when it settled. A no-op
 *  answering null anywhere but a packaged macOS build, where the inherited PATH is already the
 *  shell's. */
export function beginLoginShellPath(isPackaged: boolean, dataDir: string): Promise<void> | null {
  if (process.platform !== 'darwin' || !isPackaged) return null
  const shell = process.env.SHELL || '/bin/zsh'
  return startLoginShellPath(dataDir, shell, () => probeLoginShell(shell))
}

/** The cache and the gate around a probe. Exported so a test can hand it a probe it controls, because
 *  faking a login shell is faking the thing under test. */
export function startLoginShellPath(dataDir: string, shell: string, probe: () => Promise<string>): Promise<void> {
  const file = join(dataDir, CACHE_FILE)
  const cached = readCachedPath(file, shell)
  if (cached) process.env.PATH = cached
  const settled = (async () => {
    let path: string
    try {
      path = await probe()
    } catch (error) {
      log.warn(
        `login-shell PATH probe failed; keeping ${cached ? 'cached' : 'inherited'} PATH: ${describeError(error).message}`,
      )
      return
    }
    if (!path) return
    process.env.PATH = path
    try {
      writePrivateAtomic(file, `${JSON.stringify({ shell, path, readAt: new Date().toISOString() }, null, 2)}\n`)
    } catch (error) {
      log.warn(`could not save the login-shell PATH; the next launch probes again: ${describeError(error).message}`)
    }
  })()
  if (!cached) holdSpawnsUntil(settled)
  return settled
}

/** Hold every process this node spawns until `work` settles. `startLoginShellPath` is the one caller
 *  in production; a test drives it directly. */
export function holdSpawnsUntil(work: Promise<unknown>): void {
  // Settled, not resolved: a spawn must not inherit a rejection from whatever it was held on.
  const settled = work.then(
    () => {},
    () => {},
  )
  pending = pending ? Promise.all([pending, settled]) : settled
  // Cleared on completion so a later spawn costs nothing, not even a resolved await.
  const held = pending
  void held.then(() => {
    if (pending === held) pending = null
  })
}

/** Awaited by core/proc.ts before every spawn. Resolves immediately once the probe is done, when a
 *  cached PATH meant nothing had to wait, and on every platform that never started one. */
export async function spawnsReady(): Promise<void> {
  if (pending) await pending
}

// A file that is missing, does not parse, names another shell, or holds an empty PATH counts as no
// answer, so the launch waits for the probe as a first launch does.
function readCachedPath(file: string, shell: string): string | null {
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as { shell?: unknown; path?: unknown }
    return cached.shell === shell && typeof cached.path === 'string' && cached.path ? cached.path : null
  } catch {
    return null
  }
}

function probeLoginShell(shell: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(shell, ['-lic', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout.trim())
    })
  })
}
