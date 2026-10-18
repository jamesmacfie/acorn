import { createLogger, emitSpan, newSpanId, newTraceId, whenTelemetryEnabled } from '@acorn/node-core/server/telemetry'

// One tag for the account, so its lines keep the `[service:boot]` prefix a person greps for and
// docs/local-development/profiling.md § Timing a cold start names.
const bootLog = createLogger('service:boot')

export type BootTimer = {
  mark(label: string): void
  /** The boot's last mark is taken. Its spans go out once telemetry is on, which may be now. */
  finish(): void
}

// `from` and `at` are milliseconds since the process started.
type Mark = { label: string; from: number; at: number }

// The node's cold-start account, one line per step, and unconditional: a node that took eleven seconds
// to bind should say so without anyone having asked for it. Per-request timing is the opposite and sits
// behind ACORN_PERF=1 (node-core server/telemetry/collector.ts).
//
// On stderr, like every other line the node writes. Stdout is a wire in the standalone entry and in
// the helper, and the desktop boot test reads the helper's `[helper:boot]` lines rather than these.
//
// Two numbers per line, because both questions get asked. `+Nms` is the offset from the first line, so
// a person can read the shape of a boot down the column; `(Nms)` is this step alone, so the one step
// that cost the boot is the one wide number. The plugin passes are named per plugin because `install`
// alone cannot say which plugin was the slow one. Those lines are wall-clock slices rather than
// per-plugin costs, because the passes overlap: a plugin's line says when it finished
// (docs/local-development/profiling.md § Timing a cold start).
//
// The same marks also become spans: one `node.boot` with a `node.boot.mark` child per mark, the shape
// of the helper's `helperBootSpans`. Retroactive, because the switch is a preference this boot reads
// partway through, so a span built where its mark was taken would be dropped. They go out once, when
// the boot finishes and telemetry is on, whichever comes last (docs/telemetry/node-boot.md).
export function bootTimer(): BootTimer {
  const started = process.hrtime.bigint()
  // `performance.now()` counts from process start, so the first mark covers spawning the process and
  // evaluating the bundle, which happen before any code here can run.
  const startedAt = performance.now()
  const marks: Mark[] = [{ label: 'process', from: 0, at: startedAt }]
  return {
    mark(label) {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6
      const mark = { label, from: stepStart(marks, label), at: startedAt + elapsed }
      marks.push(mark)
      bootLog.info(`${label} +${elapsed.toFixed(0)}ms (${(mark.at - mark.from).toFixed(0)}ms)`)
    },
    finish() {
      // A copy, so a later mark such as `teardown` stays out of the account.
      const account = [...marks]
      whenTelemetryEnabled(() => emitBootSpans(account))
    },
  }
}

// Where a step's own time starts: the mark before it, unless the step marked sub-steps of its own
// (`reconcile.agents.goals` before `reconcile.agents`). Then it is the mark before the first of
// them, so the step's line still reports its total.
function stepStart(marks: readonly Mark[], label: string): number {
  const first = marks.findIndex((mark) => mark.label.startsWith(`${label}.`))
  return marks[(first === -1 ? marks.length : first) - 1]!.at
}

function emitBootSpans(marks: readonly Mark[]): void {
  const origin = performance.timeOrigin
  const traceId = newTraceId()
  const root = newSpanId()
  emitSpan('core', {
    traceId,
    spanId: root,
    name: 'node.boot',
    start: origin,
    durationMs: marks[marks.length - 1]!.at,
    status: 'ok',
    attrs: { seam: 'node.boot' },
  })
  for (const { label, from, at } of marks) {
    emitSpan('core', {
      traceId,
      spanId: newSpanId(),
      parentSpanId: root,
      name: 'node.boot.mark',
      start: origin + from,
      durationMs: at - from,
      status: 'ok',
      attrs: { seam: 'node.boot.mark', mark: label },
    })
  }
}
