import { format } from 'node:util'
import { emitSpan, newSpanId, newTraceId } from '@acorn/client-core/infra/telemetry/emitter.ts'

// This host's cold-start account, held rather than printed, and the two readers it has.
//
// stderr is the file the renderer draws on, so a timing line written while the screen is up reads as
// the shell going to garbage — the same reason Node's own warnings are held. Every mark is kept and
// printed on the way out, after `renderer.destroy()` has handed the terminal back.
//
// Unconditional, unlike the desktop helper's: these lines only appear once the shell has already
// exited, where there is nothing left to interrupt, and a person who ran `acorn` and waited two
// seconds for a rail has earned the account of where they went
// (docs/local-development.md § Timing a cold start).
//
// Its own module rather than a block at the top of `./main.tsx`, because the second reader is the
// telemetry pass and that runs from `./App.tsx`. The marks are recorded either way and cost one
// `hrtime` read each; what the switch decides is whether they also become spans
// (docs/tui.md § What the terminal client reports).

const bootStarted = process.hrtime.bigint()
const marks: { label: string; at: number }[] = []

export function bootMark(label: string): void {
  marks.push({ label, at: Number(process.hrtime.bigint() - bootStarted) / 1e6 })
}

/** The `[acorn:boot]` account, on the way out. The caller supplies the writer, because by then it is
 *  a released console and this module has no opinion about which one. */
export function printBootMarks(write: (line: string) => void): void {
  let previous = 0
  for (const { label, at } of marks) {
    write(`[acorn:boot] ${label} +${at.toFixed(0)}ms (${(at - previous).toFixed(0)}ms)`)
    previous = at
  }
}

/** What this process wanted to say and could not, because stderr is the screen. Printed on the way
 *  out beside the boot account. `format` rather than `String`, so an Error still prints its stack
 *  and `%s` still means what the caller meant. */
const held: string[] = []
export const holdLine = (...args: unknown[]): void => void held.push(format(...args))
export const heldLines = (): readonly string[] => held

// Built by hand rather than through `startSpan`, because these describe a stretch of time that is
// already over: `startSpan` times from the moment it is called, and every mark was recorded before
// the switch was known.
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

let emitted = false

/**
 * The same marks as spans, once telemetry is on.
 *
 * Retroactive on purpose. The switch is a preference on the node and the answer arrives a round trip
 * after the shell has already drawn, so a boot span emitted where the mark was recorded would always
 * be built with collection off and dropped. The marks are held anyway for the account above, so
 * turning them into spans afterwards costs nothing.
 *
 * One `tui.boot` root with a child per mark, measured from the mark before it, which is the same
 * arrangement the desktop helper's marks get (packages/custody/src/telemetry.ts).
 */
export function emitBootSpans(): void {
  if (emitted || marks.length === 0) return
  emitted = true
  const last = marks[marks.length - 1]!.at
  const startedAt = Date.now() - last
  const root = spanAt('tui.boot', startedAt, last, {})
  let previous = 0
  for (const { label, at } of marks) {
    spanAt('tui.boot.mark', startedAt + previous, at - previous, { mark: label }, root)
    previous = at
  }
}

/** Test seam: forget the marks and the held lines. */
export function _resetBoot(): void {
  marks.length = 0
  held.length = 0
  emitted = false
}
