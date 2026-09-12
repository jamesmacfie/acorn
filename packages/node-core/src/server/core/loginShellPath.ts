// The login-shell PATH probe, and the gate that makes it safe to run it off the critical path.
//
// On a packaged macOS build a GUI-launched process inherits a minimal PATH, so the node asks the
// owner's login shell what theirs is. That costs half a second to two seconds on a profile with a
// version manager in it, and the answer is only needed to spawn agents and build commands — not to
// migrate a database or bind a listener. So the boot starts the probe and moves on, and the first
// process this node spawns is the thing that waits.
//
// See docs/node-distribution.md § Boot order, and core/proc.ts for the one place that waits.
import { execFile } from 'node:child_process'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('service:boot')

// Long enough for a slow profile, short enough that a broken shell cannot wedge the first spawn
// forever. Unchanged from when the probe ran in front of the whole boot.
const PROBE_TIMEOUT_MS = 5_000

let pending: Promise<unknown> | null = null

/** Start the probe and hold spawns on it. A no-op anywhere but a packaged macOS build, where the
 *  inherited PATH is already the shell's. */
export function beginLoginShellPath(isPackaged: boolean): void {
  if (process.platform !== 'darwin' || !isPackaged) return
  holdSpawnsUntil(readLoginShellPath())
}

/** Hold every process this node spawns until `work` settles. The probe above is the one caller in
 *  production; a test drives it directly, because faking a login shell is faking the thing under
 *  test. */
export function holdSpawnsUntil(work: Promise<unknown>): void {
  // Settled, not resolved: a probe that failed has already warned and kept the inherited PATH, and a
  // spawn must not inherit its rejection.
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

/** Awaited by core/proc.ts before every spawn. Resolves immediately once the probe is done, and
 *  immediately on every platform that never started one. */
export async function spawnsReady(): Promise<void> {
  if (pending) await pending
}

async function readLoginShellPath(): Promise<void> {
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const path = await new Promise<string>((resolve, reject) => {
      execFile(shell, ['-lic', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout.trim())
      })
    })
    if (path) process.env.PATH = path
  } catch (error) {
    log.warn(`login-shell PATH probe failed; keeping inherited PATH: ${describeError(error).message}`)
  }
}
