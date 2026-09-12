import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TelemetryMetric, TelemetryRecord, TelemetrySpan } from '@acorn/protocol/telemetry.ts'
import {
  flushTelemetry,
  measure,
  onTelemetryBatch,
  recordDuration,
  resetTelemetryForTest,
  runWithTelemetry,
  startSpan,
  startTelemetry,
} from './collector'
import { currentTelemetryContext, runWithTelemetryContext } from './context'

const CONTEXT = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), owner: 'rollbar' }

describe('the ambient context', () => {
  it('answers inside the store and not outside it', () => {
    expect(currentTelemetryContext()).toBeUndefined()
    runWithTelemetryContext(CONTEXT, () => {
      expect(currentTelemetryContext()).toEqual(CONTEXT)
    })
    expect(currentTelemetryContext()).toBeUndefined()
  })

  // The whole reason for an async-local store rather than an argument: git and SQL are reached from
  // inside awaited work several frames below the seam that knows the owner.
  it('survives an await', async () => {
    await runWithTelemetryContext(CONTEXT, async () => {
      await Promise.resolve()
      await new Promise((resolve) => setImmediate(resolve))
      expect(currentTelemetryContext()?.owner).toBe('rollbar')
    })
  })

  it('survives a timer', async () => {
    const owner = await runWithTelemetryContext(
      CONTEXT,
      () => new Promise<string | undefined>((resolve) => setTimeout(() => resolve(currentTelemetryContext()?.owner), 1)),
    )
    expect(owner).toBe('rollbar')
  })

  it('nests, and the inner one wins for its own frames', () => {
    runWithTelemetryContext(CONTEXT, () => {
      runWithTelemetryContext({ ...CONTEXT, owner: 'github' }, () => {
        expect(currentTelemetryContext()?.owner).toBe('github')
      })
      expect(currentTelemetryContext()?.owner).toBe('rollbar')
    })
  })

  it('is not entered at all when nothing is collecting', () => {
    resetTelemetryForTest()
    runWithTelemetry(CONTEXT, () => {
      expect(currentTelemetryContext()).toBeUndefined()
    })
  })
})

describe('what the seams read off it', () => {
  const settle = async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  }
  let seen: TelemetryRecord[]

  beforeEach(async () => {
    resetTelemetryForTest()
    seen = []
    startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
    onTelemetryBatch((batch) => seen.push(...batch.records))
    await settle()
  })

  afterEach(() => resetTelemetryForTest())

  const records = (): TelemetryRecord[] => {
    flushTelemetry()
    return seen
  }
  const metrics = (): TelemetryMetric[] => records().filter((record): record is TelemetryMetric => record.kind === 'metric')

  it("gives 'core' the ambient owner and leaves a named one alone", () => {
    runWithTelemetry(CONTEXT, () => {
      recordDuration('core', 'git.status', 4)
      recordDuration('github', 'git.fetch', 7)
    })
    expect(metrics().map((metric) => [metric.name, metric.attrs.owner])).toEqual([
      ['git.status', 'rollbar'],
      ['git.fetch', 'github'],
    ])
  })

  it('resolves the owner through measure, including after the promise settles', async () => {
    await runWithTelemetry(CONTEXT, async () => measure('core', 'sql.select', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return 42
    }))
    expect(metrics()[0]).toMatchObject({ name: 'sql.select', attrs: { owner: 'rollbar' } })
  })

  it('hangs a span raised inside the context under it', () => {
    runWithTelemetry(CONTEXT, () => startSpan('core', { name: 'tool.call' }).end())
    const span = records().find((record): record is TelemetrySpan => record.kind === 'span')!
    expect(span).toMatchObject({ traceId: CONTEXT.traceId, parentSpanId: CONTEXT.spanId })
    expect(span.attrs.owner).toBe('rollbar')
  })

  it('leaves a record raised outside every context filed under core', () => {
    recordDuration('core', 'git.status', 4)
    expect(metrics()[0]!.attrs.owner).toBe('core')
  })
})

describe('a histogram keeps one label set', () => {
  const settle = async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  }
  let seen: TelemetryRecord[]

  beforeEach(async () => {
    resetTelemetryForTest()
    seen = []
    startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
    onTelemetryBatch((batch) => seen.push(...batch.records))
    await settle()
  })

  afterEach(() => resetTelemetryForTest())

  const metrics = (): TelemetryMetric[] => {
    flushTelemetry()
    return seen.filter((record): record is TelemetryMetric => record.kind === 'metric')
  }

  // Merging on owner and seam alone kept the first sample's attributes for the whole window, so a
  // seam with a varying label reported one value for every sample.
  it('splits samples whose attributes differ', () => {
    recordDuration('core', 'ws.frame', 1, { channel: 'term' })
    recordDuration('core', 'ws.frame', 3, { channel: 'term' })
    recordDuration('core', 'ws.frame', 9, { channel: 'agent' })
    const byChannel = Object.fromEntries(metrics().map((metric) => [metric.attrs.channel, metric.value]))
    expect(byChannel.term).toMatchObject({ count: 2, sum: 4 })
    expect(byChannel.agent).toMatchObject({ count: 1, sum: 9 })
  })

  it('reads two attribute orders as one series', () => {
    recordDuration('core', 'ws.frame', 1, { channel: 'term', kind: 'json' })
    recordDuration('core', 'ws.frame', 3, { kind: 'json', channel: 'term' })
    expect(metrics()).toHaveLength(1)
    expect(metrics()[0]!.value).toMatchObject({ count: 2 })
  })

  it('drops the labels rather than the sample once the series cap is reached', () => {
    for (let index = 0; index < 260; index += 1) recordDuration('core', 'ws.frame', 1, { channel: `c${index}` })
    const series = metrics().filter((metric) => metric.name === 'ws.frame')
    expect(series.length).toBeLessThanOrEqual(201)
    // Nothing is lost: every sample is still counted somewhere.
    const counted = series.reduce((total, metric) => total + (typeof metric.value === 'number' ? 0 : metric.value.count), 0)
    expect(counted).toBe(260)
    // And the overflow is visible instead of silent.
    expect(metrics().some((metric) => metric.name === 'telemetry.truncated')).toBe(true)
  })
})
