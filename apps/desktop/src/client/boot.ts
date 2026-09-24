import { emitSpan, newSpanId, newTraceId, telemetryEnabled } from '@acorn/client-core/infra/telemetry/emitter.ts'
import { createLogger } from '@acorn/client-core/infra/telemetry'

// The renderer's half of a cold-start timeline, and the two readers it has.
//
// `performance.mark` always, because it costs nothing and puts the same labels in the devtools
// performance panel; the console line only when asked, because this console is the one a developer
// has open while using the app.
//
// The switch is localStorage rather than `ACORN_PERF`, which is the environment variable the node and
// the helper read: there is no environment in a webview, and the renderer is loaded by Rust's custom
// scheme rather than spawned. `localStorage.setItem('acorn.perf', '1')` and reload
// (docs/local-development.md § Timing a cold start).
//
// `performance.now()` counts from this document's navigation, so these offsets are the renderer's own
// and start where the helper's ready line left off.
//
// The second reader is telemetry, which turns the same marks into spans once the owner has switched
// it on (docs/telemetry.md § The renderer). The terminal client and the helper do the same with their
// own marks (apps/tui/src/boot.ts, packages/custody/src/bootMarks.ts).

const log = createLogger('renderer:boot')

const printing = (() => {
  try {
    return localStorage.getItem('acorn.perf') === '1'
  } catch {
    // A webview with site data blocked. Not a reason to fail a boot over.
    return false
  }
})()

/** The mark the account ends on. Everything before it is the window getting from nothing to a
 *  node it can use, which is the launch an owner waits through. */
const LAST = 'nodeReady'

const marks: { label: string; at: number }[] = []

export function bootMark(label: string): void {
  const at = performance.now()
  marks.push({ label, at })
  performance.mark(`acorn:${label}`)
  if (printing) log.info(`${label} +${at.toFixed(0)}ms`)
}

let emitted = false

/**
 * The marks as spans: one `renderer.boot` root from navigation to `nodeReady`, with a child per mark
 * measured from the mark before it. The first child is loading and evaluating the scripts, because
 * its start is navigation.
 *
 * Retroactive on purpose. The switch is a preference on the node, so it is not known while most of
 * these marks are taken, and a span built then would be dropped. It is called from both things that
 * can come last, the switch turning on and the `nodeReady` mark, and waits for both. A mark taken
 * after `nodeReady` is not part of the span.
 */
export function emitBootSpans(): void {
  if (emitted || !telemetryEnabled()) return
  const end = marks.findIndex((mark) => mark.label === LAST)
  if (end === -1) return
  emitted = true
  // Absolute times off the navigation origin rather than `Date.now()`, so the spans sit where the
  // launch happened however late the switch was read.
  const origin = performance.timeOrigin
  const root = spanAt('renderer.boot', origin, marks[end]!.at, {})
  let previous = 0
  for (const { label, at } of marks.slice(0, end + 1)) {
    spanAt('renderer.boot.mark', origin + previous, at - previous, { mark: label }, root)
    previous = at
  }
}

// Built by hand rather than through `startSpan`, because these describe a stretch of time that is
// already over: `startSpan` times from the moment it is called.
function spanAt(
  name: string,
  start: number,
  durationMs: number,
  attrs: Record<string, string>,
  parent?: { traceId: string; spanId: string },
): { traceId: string; spanId: string } {
  const traceId = parent?.traceId ?? newTraceId()
  const spanId = newSpanId()
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

/** Test seam: forget the marks. */
export function _resetBoot(): void {
  marks.length = 0
  emitted = false
}
