import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TelemetryRecord, TelemetrySpan } from '@acorn/protocol/telemetry.ts'
import {
  _resetClientTelemetry,
  flushTelemetry,
  setTelemetryEnabled,
  startClientTelemetry,
} from '@acorn/client-core/infra/telemetry/emitter.ts'
import { _resetBoot, bootMark, emitBootSpans } from './boot'

let posted: TelemetryRecord[]

const spans = (name: string): TelemetrySpan[] =>
  posted.filter((record): record is TelemetrySpan => record.kind === 'span' && record.name === name)

beforeEach(() => {
  posted = []
  startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push(...records) })
})

afterEach(() => {
  _resetClientTelemetry()
  _resetBoot()
})

describe('the renderer boot account', () => {
  it('becomes one root span from navigation to nodeReady, with a child per mark', async () => {
    bootMark('script start')
    bootMark('tree built')
    bootMark('nodeReady')
    bootMark('plugins applied')
    setTelemetryEnabled(true)
    emitBootSpans()
    await flushTelemetry()

    const [root] = spans('renderer.boot')
    expect(root).toBeDefined()
    expect(root!.start).toBe(performance.timeOrigin)
    const children = spans('renderer.boot.mark')
    // A mark after nodeReady is not part of the launch.
    expect(children.map((span) => span.attrs.mark)).toEqual(['script start', 'tree built', 'nodeReady'])
    for (const child of children) {
      expect(child.traceId).toBe(root!.traceId)
      expect(child.parentSpanId).toBe(root!.spanId)
    }
    const last = children[children.length - 1]!
    expect(last.start + last.durationMs).toBeCloseTo(root!.start + root!.durationMs)
  })

  it('waits for both the switch and nodeReady, and emits once', async () => {
    bootMark('script start')
    emitBootSpans()
    setTelemetryEnabled(true)
    emitBootSpans()
    bootMark('nodeReady')
    emitBootSpans()
    emitBootSpans()
    await flushTelemetry()
    expect(spans('renderer.boot')).toHaveLength(1)
  })
})
