// How many times the background service may crash before the app stops restarting it, and how long to
// wait before each retry.
//
// A pure function rather than inline in the helper's composition root, because it's the arithmetic
// that decides whether a user gets a recovery screen or an infinite restart loop, and inline it could
// only be exercised by booting the app and crashing a real service five times.
//
// The rest of the interlock (`disposed`, `recovering`) stays in index.ts: those are ordering flags
// around the shell's own lifecycle events.
//
// It also reports, because a node dying under the helper is a silent event today and the count in
// the window is the number that decides what happens next (docs/shell.md § What the helper reports).
import { emitError, emitEvent } from '@acorn/node-core/server/telemetry/collector.ts'

// Five backoffs for five permitted crashes: 1s, 2s, 4s, 8s, 16s. The sixth crash inside the window
// gives up.
export const CRASH_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000]
export const CRASH_WINDOW_MS = 10 * 60_000
export const MAX_CRASHES_PER_WINDOW = 5

export type CrashDecision =
  // Wait, then start the service again.
  | { retry: true; delayMs: number }
  // Too many crashes too fast. Show the recovery screen instead of restarting into the same fault.
  | { retry: false }

// `times` is mutated: crashes outside the window are dropped and `now` is appended. The caller holds the
// array across a whole app session, and a sliding window is the only way "five crashes in ten minutes"
// differs from "five crashes ever".
export function recordCrash(times: number[], now: number): CrashDecision {
  times.push(now)
  while (times[0] != null && times[0] < now - CRASH_WINDOW_MS) times.shift()
  if (times.length > MAX_CRASHES_PER_WINDOW) {
    // A fatal error rather than an event, because this is the end of the app's ability to recover on
    // its own: the recovery screen goes up and nothing restarts until the owner says so. `handled`
    // is true because acorn does have an answer for it, and it is not the process dying
    // (docs/shell.md § What the helper reports).
    emitError('core', {
      name: 'CrashBudgetExhausted',
      message: `the background service crashed ${times.length} times in ${CRASH_WINDOW_MS / 60_000} minutes`,
      level: 'fatal',
      handled: true,
      attrs: { seam: 'node.crash', crashes: times.length },
    })
    return { retry: false }
  }
  emitEvent('core', 'node.crash', { crashes: times.length, 'window.ms': CRASH_WINDOW_MS })
  // Clamped, so a crash count beyond the table still yields the longest backoff rather than `undefined`.
  return { retry: true, delayMs: CRASH_BACKOFF_MS[Math.min(times.length - 1, CRASH_BACKOFF_MS.length - 1)]! }
}
