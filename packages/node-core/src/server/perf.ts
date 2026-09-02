// What the node says about its own timing, and the one switch that turns it on.
//
// Boot marks are not here: those are unconditional and belong to the composition root's `bootTimer`
// (apps/node/src/composition/runtime.ts), because a node that took eleven seconds to bind should say so
// without anyone having asked. Everything in this file is per-request or per-call, which is noise on a
// healthy node and the only way to find an unhealthy one, so it is behind `ACORN_PERF=1`
// (docs/local-development.md § Timing a cold start).
//
// Two shapes:
//
//   a line per request, from the request-id middleware (./respond.ts), because the id is minted there
//   and a duration without an id correlates with nothing;
//
//   a histogram per seam, for the two things the node does over and over with nothing counting them:
//   spawning git (./core/git.ts) and running SQLite statements (./storage/sqlite.ts). Those exist
//   because the performance programme refused to split the node into threads on a structural argument
//   and asked for numbers instead (docs/future/performance/refused.md § Splitting the node).
//
// Printed, never stored. No perf database and no dashboard: a developer reads a dozen lines with a
// running offset, and `kill -USR2 <pid>` asks for the histograms mid-session.

export const PERF = process.env.ACORN_PERF === '1'

type Histogram = { count: number; total: number; max: number; samples: number[] }

const histograms = new Map<string, Histogram>()
// Enough samples for a percentile to mean something over a working session, and bounded so a node left
// running for a week cannot grow a heap out of its own instrumentation. Past the cap the count, total
// and max stay exact and the percentiles describe the first 20,000 calls. If that stops being enough,
// the upgrade is fixed-width buckets rather than a bigger array.
const MAX_SAMPLES = 20_000

export function recordDuration(seam: string, ms: number): void {
  let histogram = histograms.get(seam)
  if (!histogram) {
    histogram = { count: 0, total: 0, max: 0, samples: [] }
    histograms.set(seam, histogram)
  }
  histogram.count += 1
  histogram.total += ms
  histogram.max = Math.max(histogram.max, ms)
  if (histogram.samples.length < MAX_SAMPLES) histogram.samples.push(ms)
}

/**
 * Time one call into a seam. Returns the seam's own result untouched, and costs a closure and two
 * `hrtime` reads when `ACORN_PERF=1`, nothing at all otherwise.
 */
export function timed<T>(seam: string, run: () => T): T {
  if (!PERF) return run()
  const started = process.hrtime.bigint()
  const finish = () => recordDuration(seam, Number(process.hrtime.bigint() - started) / 1e6)
  let result: T
  try {
    result = run()
  } catch (error) {
    finish()
    throw error
  }
  // A promise is timed to settlement rather than to the call that started it, which for a git spawn is
  // the whole of the duration. `finally` rather than `then`, so a rejection is still counted.
  if (result instanceof Promise) return result.finally(finish) as T
  finish()
  return result
}

const percentile = (sorted: readonly number[], fraction: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]

/** Print every histogram and clear them, so a second dump reports the interval rather than all time. */
export function dumpPerf(reason: string): void {
  if (!PERF) return
  if (histograms.size === 0) {
    console.error(`[perf:${reason}] nothing recorded`)
    return
  }
  for (const [seam, histogram] of [...histograms].sort((a, b) => b[1].total - a[1].total)) {
    const sorted = [...histogram.samples].sort((a, b) => a - b)
    const ms = (value: number) => value.toFixed(1)
    console.error(
      `[perf:${reason}] ${seam} count=${histogram.count} total=${ms(histogram.total)}ms`
      + ` mean=${ms(histogram.total / histogram.count)}ms p50=${ms(percentile(sorted, 0.5))}ms`
      + ` p95=${ms(percentile(sorted, 0.95))}ms max=${ms(histogram.max)}ms`,
    )
  }
  histograms.clear()
}

// Asked for mid-session rather than waiting for a drain, because the interesting minute is usually not
// the last one. Installed once, and only when the switch is on, so a node in normal operation keeps
// whatever SIGUSR2 meant to it before.
if (PERF) {
  process.on('SIGUSR2', () => dumpPerf('sigusr2'))
  console.error('[perf] ACORN_PERF=1: request durations on, git and SQLite histograms on, `kill -USR2` to dump')
}
