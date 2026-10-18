import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest'
import type { TelemetryRecord, TelemetrySpan } from '@acorn/protocol/telemetry.ts'
import { flushTelemetry, onTelemetryBatch, setTelemetryPref, startTelemetry } from '@acorn/node-core/server/telemetry'
import { resetTelemetryForTest } from '@acorn/node-core/testkit'
import { bootTimer } from './bootTimer'

let printed: MockInstance<typeof console.error>
let records: TelemetryRecord[]
// Each mark reads the clock once, after the timer's own first read at 0 ms.
let clockMs = 0
const at = (ms: number) => (clockMs = ms)

beforeEach(() => {
  resetTelemetryForTest()
  records = []
  clockMs = 0
  vi.spyOn(process.hrtime, 'bigint').mockImplementation(() => BigInt(Math.round(clockMs * 1e6)))
  printed = vi.spyOn(console, 'error').mockImplementation(() => {})
  // The preference is on, but nothing collects until a sink subscribes.
  startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
})

afterEach(() => {
  resetTelemetryForTest()
  vi.restoreAllMocks()
})

const collect = async () => {
  onTelemetryBatch((batch) => records.push(...batch.records))
  await Promise.resolve()
}
const bootSpans = (): TelemetrySpan[] => {
  flushTelemetry()
  return records.filter((record): record is TelemetrySpan => record.kind === 'span')
}

function boot() {
  const timer = bootTimer()
  at(12.4)
  timer.mark('login-shell')
  at(30)
  timer.mark('reconcile.workflow')
  at(45)
  timer.mark('reconcile.agents.unsettled')
  at(70)
  timer.mark('reconcile.agents.goals')
  at(71)
  timer.mark('reconcile.agents')
  return timer
}

it('prints each mark as it always has, and gives a step with sub-steps its total', () => {
  boot()
  expect(printed.mock.calls.map(([line]) => line)).toEqual([
    '[service:boot] login-shell +12ms (12ms)',
    '[service:boot] reconcile.workflow +30ms (18ms)',
    '[service:boot] reconcile.agents.unsettled +45ms (15ms)',
    '[service:boot] reconcile.agents.goals +70ms (25ms)',
    '[service:boot] reconcile.agents +71ms (41ms)',
  ])
})

it('turns marks taken with telemetry off into spans once it turns on, after the last mark, once', async () => {
  const timer = boot()
  await collect()
  expect(bootSpans()).toEqual([])

  timer.finish()
  const spans = bootSpans()
  const root = spans.find((span) => span.name === 'node.boot')!
  const marks = spans.filter((span) => span.name === 'node.boot.mark')
  expect(marks.map((span) => span.attrs.mark)).toEqual([
    'process',
    'login-shell',
    'reconcile.workflow',
    'reconcile.agents.unsettled',
    'reconcile.agents.goals',
    'reconcile.agents',
  ])
  expect(marks.every((span) => span.parentSpanId === root.spanId && span.traceId === root.traceId)).toBe(true)
  // The process mark runs from process start, so the root covers the whole boot.
  expect(marks[0]!.start).toBe(root.start)
  expect(root.durationMs - marks[0]!.durationMs).toBeCloseTo(71)
  expect(marks.find((span) => span.attrs.mark === 'reconcile.agents')!.durationMs).toBeCloseTo(41)

  records = []
  timer.mark('teardown')
  setTelemetryPref(false)
  setTelemetryPref(true)
  expect(bootSpans()).toEqual([])
})

it('waits for telemetry when the boot finishes first, and emits nothing if it never turns on', async () => {
  const timer = boot()
  timer.finish()
  expect(bootSpans()).toEqual([])
  await collect()
  expect(bootSpans().filter((span) => span.name === 'node.boot')).toHaveLength(1)

  resetTelemetryForTest()
  records = []
  startTelemetry({ node: 'node-1', version: '9', readPref: async () => null })
  boot().finish()
  await collect()
  expect(bootSpans()).toEqual([])
})
