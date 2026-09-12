import { emitSpan } from '@acorn/node-core/server/telemetry/collector.ts'
import { createLogger } from '@acorn/node-core/server/telemetry/logger.ts'

// The helper's cold-start account, printed behind `ACORN_PERF=1` and reported as spans whenever
// telemetry is on.
//
// The desktop opens in three processes and the helper is the middle one: Rust spawns it, it sweeps its
// caches, starts and supervises the node, binds the WebSocket the renderer talks to, and only then
// prints the ready line Rust is blocked on. Every one of those steps is in front of the window
// appearing, and none of them was timed (docs/local-development.md § Timing a cold start).
//
// stderr, not stdout: stdout is the line protocol Rust parses, and a timing line on it is a handshake
// Rust cannot read (apps/desktop/src/helper/helperMain.ts). The *printing* is behind the switch rather
// than unconditional, unlike the node's own boot marks, because this stream is the one a developer
// watches while using the app. The *recording* is unconditional and costs one `hrtime` read a mark,
// because the second reader is telemetry and it cannot ask for marks that were never taken.
//
// The clock starts when this module is evaluated, which in the helper is the first thing its bundle
// does, so the offsets are from process start closely enough to subtract from Rust's own spawn time.

export const HELPER_PERF = process.env.ACORN_PERF === '1'

// The tag is the prefix the account has always carried, so `[helper:boot] <label> +<ms>ms (<ms>ms)`
// is what reaches stderr and what the desktop boot test reads (apps/desktop/test/boot.test.ts).
const log = createLogger('helper:boot')

const started = process.hrtime.bigint()
let previous = started
const marks: { label: string; at: number }[] = []

export function helperMark(label: string): void {
  const now = process.hrtime.bigint()
  marks.push({ label, at: Number(now - started) / 1e6 })
  if (!HELPER_PERF) return
  const ms = (from: bigint) => (Number(now - from) / 1e6).toFixed(0)
  log.info(`${label} +${ms(started)}ms (${ms(previous)}ms)`)
  previous = now
}

/**
 * The same marks as spans: one `helper.boot` root with a child per mark, measured from the mark
 * before it.
 *
 * Retroactive on purpose. The switch is a preference on the node and the helper cannot read it until
 * a node has been adopted, which is itself one of the marks, so a span emitted where the mark was
 * taken would always be built with collection off and dropped. The marks are held for the printed
 * account anyway, so turning them into spans afterwards costs nothing
 * (./telemetry.ts § The switch, docs/shell.md § What the helper reports).
 *
 * Called once, by `startHelperTelemetry` the first time the answer is yes.
 */
export function helperBootSpans(): void {
  if (marks.length === 0) return
  const last = marks[marks.length - 1]!.at
  const startedAt = Date.now() - last
  const root = span('helper.boot', startedAt, last, {})
  let from = 0
  for (const { label, at } of marks) {
    span('helper.boot.mark', startedAt + from, at - from, { mark: label }, root)
    from = at
  }
}

// Built by hand rather than through `startSpan`, because these describe a stretch of time that is
// already over: `startSpan` times from the moment it is called.
function span(
  name: string,
  start: number,
  durationMs: number,
  attrs: Record<string, string>,
  parent?: { traceId: string; spanId: string },
): { traceId: string; spanId: string } {
  const traceId = parent?.traceId ?? hex(16)
  const spanId = hex(8)
  emitSpan('core', {
    traceId,
    spanId,
    ...(parent ? { parentSpanId: parent.spanId } : {}),
    name,
    start,
    durationMs,
    status: 'ok',
    attrs: { seam: name, ...attrs },
  })
  return { traceId, spanId }
}

// W3C sizes, lowercase hex. `Math.random` rather than `crypto`: a trace id is a correlation key and
// not a secret.
const hex = (bytes: number): string => {
  let out = ''
  for (let index = 0; index < bytes; index += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  return out
}

/** Test seam: forget the marks, so one case's boot account is not another's. */
export function _resetHelperMarks(): void {
  marks.length = 0
}
