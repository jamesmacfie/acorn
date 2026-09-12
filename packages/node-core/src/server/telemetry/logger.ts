// The node's logger, and the only file under `packages/node-core/src` and `apps/node/src` allowed to
// call `console.*` (tools/arch/boundaries.test.ts § the console rule).
//
// Why a logger at all, when `ctx.log` was removed on 2026-08-27 for being interchangeable with
// `console`: a line written through here carries the tag that wrote it, reaches every subscribed
// sink, and is scrubbed on the way. None of that is true of a bare `console.error`, and the
// attribution is the whole point — "which plugin logged this" is the question a person asks first
// and could not previously answer (docs/telemetry.md § Logging).
//
// Everything goes to stderr, including `info` and `debug`. Stdout is a wire: the standalone entry
// prints its handshake JSON there and the desktop helper speaks a line protocol on it, so a log line
// on stdout is a corrupted handshake. `console.error` and `console.warn` rather than
// `process.stderr.write`, because thirty-one node tests spy on those two and a logger that wrote
// underneath them would pass every one of those tests vacuously.
import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import { emitLog, onTelemetryBatch, PERF, flushTelemetry } from './collector'
import { scrub } from './scrub'

export type Logger = {
  debug(message: string, attrs?: TelemetryAttrs): void
  info(message: string, attrs?: TelemetryAttrs): void
  warn(message: string, attrs?: TelemetryAttrs): void
  error(message: string, attrs?: TelemetryAttrs): void
}

/** `{ a: 1, b: 'x' }` becomes ` a=1 b=x`, so a line stays one line and stays greppable. Values are
 *  scrubbed by the collector on the record; here they are only shortened. */
const suffix = (attrs: TelemetryAttrs | undefined): string => {
  if (!attrs) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue
    parts.push(`${key}=${typeof value === 'string' ? scrub(value).slice(0, 200) : String(value)}`)
  }
  return parts.length ? ` ${parts.join(' ')}` : ''
}

/**
 * A logger bound to one tag. `createLogger('schedules').warn('github:refresh timed out')` prints
 * `[schedules] github:refresh timed out`, which is what the hand-written prefix printed before.
 *
 * `owner` defaults to `core`. The plugin host passes the plugin id, which is what makes `ctx.log`
 * worth having.
 */
export function createLogger(tag: string, owner = 'core'): Logger {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', message: string, attrs?: TelemetryAttrs): void => {
    const line = `[${tag}] ${message}${suffix(attrs)}`
    if (level === 'warn') console.warn(line)
    else console.error(line)
    emitLog(owner, { at: Date.now(), level, logger: tag, body: message, ...(attrs ? { attrs } : {}) })
  }
  return {
    debug: (message, attrs) => write('debug', message, attrs),
    info: (message, attrs) => write('info', message, attrs),
    warn: (message, attrs) => write('warn', message, attrs),
    error: (message, attrs) => write('error', message, attrs),
  }
}

/**
 * An unknown thrown value as a name and a scrubbed one-line message, with no stack.
 *
 * No stack on purpose. A log line is read by a person scrolling, and a stack there buries the next
 * fifty lines. The two places a stack is worth sending are the crash handlers and the renderer's
 * global handlers, and both build their error record directly.
 */
export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || 'Error', message: scrub(error.message, error.name || 'Error') }
  return { name: 'Error', message: scrub(error, 'unknown error') }
}

// ── The ACORN_PERF console sink ───────────────────────────────────────────────────────────────────
//
// `ACORN_PERF=1` was a printer of its own until the collector existed (`server/perf.ts`, deleted).
// It is a sink now, and prints the same two shapes: a line per request, and a histogram table per
// dump. The request line is printed at the seam rather than from here, because a sink is called on
// the flush timer and a developer watching a dev server wants the line when the request finishes,
// not in a burst five seconds later.

/** One line of `ACORN_PERF=1` output at the moment it happens. A no-op with the switch off. */
export const perfLine = (text: string): void => {
  if (PERF) console.error(text)
}

const ms = (value: number): string => value.toFixed(1)

let installed = false

/**
 * Print histograms to stderr while `ACORN_PERF=1`, and dump on `SIGUSR2`.
 *
 * Installed once per process. `kill -USR2 <pid>` asks for the numbers mid-session, because the
 * interesting minute is usually not the last one, and a flush clears what it printed so a second
 * dump describes the interval rather than all time.
 */
export function installPerfSink(): void {
  if (!PERF || installed) return
  installed = true
  onTelemetryBatch((batch) => {
    const histograms = batch.records.filter((record) => record.kind === 'metric' && record.type === 'histogram')
    for (const record of histograms) {
      if (record.kind !== 'metric' || typeof record.value === 'number') continue
      const value = record.value
      console.error(
        `[perf] ${record.name} count=${value.count} total=${ms(value.sum)}ms`
        + ` mean=${ms(value.sum / Math.max(value.count, 1))}ms p50=${ms(value.p50)}ms`
        + ` p95=${ms(value.p95)}ms max=${ms(value.max)}ms`,
      )
    }
  })
  process.on('SIGUSR2', () => flushTelemetry())
  console.error('[perf] ACORN_PERF=1: request durations on, git and SQLite histograms on, `kill -USR2` to dump')
}
