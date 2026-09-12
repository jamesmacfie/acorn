/** @jsxImportSource @acorn/tui/jsx */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QueryClient } from '@tanstack/solid-query'
import type { TelemetryMetric, TelemetryRecord, TelemetrySpan } from '@acorn/protocol/telemetry.ts'
import {
  _resetClientTelemetry,
  flushTelemetry,
  setTelemetryEnabled,
  startClientTelemetry,
} from '@acorn/client-core/infra/telemetry/emitter.ts'
import { prefsKey } from '@acorn/protocol/api.ts'
import { PrefKeys } from '@acorn/client-core/infra/persistence/prefKeys.ts'
import { _resetBoot, bootMark, emitBootSpans } from './boot'
import { renderFixture } from './harness'

// What this host reports, through the app rather than through the seams
// (docs/tui.md § What the terminal client reports).
//
// The fixture is the point. A frame histogram asserted by calling `screen.frame()` on a renderer
// built here would be testing four `performance.now()` reads; driven through `renderFixture` it is
// testing that the paint path the app actually uses is the one wired to the emitter.
//
// The switch is seeded into the query cache rather than set on the emitter, because `App.tsx` reads
// the preference and turns the emitter off when it says no. A case that called `setTelemetryEnabled`
// and then mounted the app would watch the app turn it straight back off, which is the arrangement
// working (./App.tsx § Telemetry).

let posted: TelemetryRecord[]

const collect = (): void => {
  posted = []
  startClientTelemetry({
    runtime: 'tui',
    post: async (records) => void posted.push(...records),
  })
}

/** The one preference, warm in the cache before the shell mounts, so the effect that reads it turns
 *  collection on rather than off. */
const withTelemetry = { cache: (client: QueryClient) => client.setQueryData(prefsKey, { [PrefKeys.telemetry]: '1' }) }

const metrics = (name: string): TelemetryMetric[] =>
  posted.filter((record): record is TelemetryMetric => record.kind === 'metric' && record.name === name)

beforeEach(() => {
  _resetClientTelemetry()
  _resetBoot()
  collect()
})
afterEach(() => {
  _resetClientTelemetry()
  _resetBoot()
})

describe('the frame histogram', () => {
  it('reports one series per phase and a total, from the shell drawing itself', async () => {
    const screen = await renderFixture({ pane: 'notes', ...withTelemetry })
    await screen.until('TASK')
    screen.done()
    await flushTelemetry()

    const frames = metrics('tui.frame')
    expect(frames.map((metric) => metric.attrs.phase).sort()).toEqual(['flush', 'layout', 'paint', 'total'])
    // One row per phase and not one row for all four, which is what the merge key by label set buys
    // (client-core infra/telemetry/emitter.ts § recordDuration).
    for (const metric of frames) {
      expect(metric.type).toBe('histogram')
      expect(metric.attrs.runtime).toBe('tui')
      expect(metric.attrs.owner).toBe('core')
      const value = metric.value as { count: number; sum: number }
      expect(value.count).toBeGreaterThan(0)
    }
    // A frame is its three halves, so the total's count matches each phase's and its sum is at
    // least as large. Counts rather than sums, because the two are folded from the same samples.
    const total = frames.find((metric) => metric.attrs.phase === 'total')!
    const layout = frames.find((metric) => metric.attrs.phase === 'layout')!
    expect((total.value as { count: number }).count).toBe((layout.value as { count: number }).count)
  })

  it('builds nothing at all with the switch off', async () => {
    const screen = await renderFixture({ pane: 'notes' })
    await screen.until('TASK')
    screen.done()
    await flushTelemetry()
    expect(posted).toEqual([])
  })
})

describe('the key histogram', () => {
  it('takes one sample per press, labelled with what answered it', async () => {
    const screen = await renderFixture({ pane: 'notes', ...withTelemetry })
    await screen.until('TASK')
    await screen.press('TAB')
    await screen.press('TAB')
    screen.done()
    await flushTelemetry()

    const keys = metrics('tui.key')
    expect(keys.length).toBeGreaterThan(0)
    const pressed = keys.reduce((total, metric) => total + (metric.value as { count: number }).count, 0)
    expect(pressed).toBe(2)
    for (const metric of keys) expect(typeof metric.attrs.reason).toBe('string')
    // The step counter is behind `ACORN_TUI_KEYS_TRACE`, and its seam is only collected with it on.
    expect(metrics('tui.key.steps')).toEqual([])
  })

  it('takes no sample with the switch off', async () => {
    const screen = await renderFixture({ pane: 'notes' })
    await screen.until('TASK')
    await screen.press('TAB')
    screen.done()
    await flushTelemetry()
    expect(metrics('tui.key')).toEqual([])
  })
})

describe('the boot account', () => {
  it('becomes one root span with a child per mark, in the order they were taken', async () => {
    setTelemetryEnabled(true)
    bootMark('node open')
    bootMark('cache restored')
    bootMark('first draw')
    emitBootSpans()
    await flushTelemetry()

    const spans = posted.filter((record): record is TelemetrySpan => record.kind === 'span')
    const root = spans.find((span) => span.name === 'tui.boot')
    expect(root).toBeDefined()
    const children = spans.filter((span) => span.name === 'tui.boot.mark')
    expect(children.map((span) => span.attrs.mark)).toEqual(['node open', 'cache restored', 'first draw'])
    // One trace, hung under the root, so a reader sees the boot as one thing and not three.
    for (const child of children) {
      expect(child.traceId).toBe(root!.traceId)
      expect(child.parentSpanId).toBe(root!.spanId)
    }
  })

  it('emits once, however many times the switch is read', async () => {
    setTelemetryEnabled(true)
    bootMark('node open')
    emitBootSpans()
    emitBootSpans()
    await flushTelemetry()
    expect(posted.filter((record) => record.kind === 'span' && record.name === 'tui.boot')).toHaveLength(1)
  })
})
