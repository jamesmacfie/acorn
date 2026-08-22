// How many times the background service may crash before the app stops restarting it, and how long to
// wait before each retry.
//
// A pure function rather than inline in bootstrap.ts, because it's the arithmetic that decides whether
// a user gets a recovery screen or an infinite restart loop, and inline it could only be exercised by
// booting Electron and crashing a real service five times.
//
// The rest of the interlock (`disposed`, `recovering`, `bootComplete`) stays in bootstrap.ts: those are
// ordering flags around Electron's own events.

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
  if (times.length > MAX_CRASHES_PER_WINDOW) return { retry: false }
  // Clamped, so a crash count beyond the table still yields the longest backoff rather than `undefined`.
  return { retry: true, delayMs: CRASH_BACKOFF_MS[Math.min(times.length - 1, CRASH_BACKOFF_MS.length - 1)]! }
}
