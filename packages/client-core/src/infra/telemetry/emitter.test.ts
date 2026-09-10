import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { parseTraceparent } from '@acorn/protocol/telemetry.ts'
import {
  _resetClientTelemetry,
  currentTraceparent,
  emitEvent,
  flushTelemetry,
  measure,
  recordDuration,
  recordSample,
  onTelemetryActivity,
  currentActivity,
  setTelemetryEnabled,
  startClientTelemetry,
  startInteraction,
  startRenderTransition,
  telemetryEnabled,
} from './emitter'

let posted: TelemetryRecord[][]

const start = (post: (records: readonly TelemetryRecord[]) => Promise<void> = async (records) => void posted.push([...records])) => {
  startClientTelemetry({ runtime: 'renderer', post })
}

beforeEach(() => {
  _resetClientTelemetry()
  posted = []
})
afterEach(() => {
  _resetClientTelemetry()
  vi.useRealTimers()
})

describe('with the switch off', () => {
  it('builds nothing at all', async () => {
    start()
    expect(telemetryEnabled()).toBe(false)
    emitEvent('core', 'nav.change')
    await flushTelemetry()
    expect(posted).toEqual([])
  })

  it('hands an inert span back, so a caller writes the same two lines either way', () => {
    start()
    const span = startInteraction('core', { name: 'command' })
    expect(span.traceId).toBe('')
    span.end()
    expect(currentTraceparent()).toBeUndefined()
  })

  it('runs the measured call and returns its own result untouched', () => {
    start()
    expect(measure('core', 'ws.inbound', () => 41 + 1)).toBe(42)
  })
})

describe('the interaction trace', () => {
  beforeEach(() => {
    start()
    setTelemetryEnabled(true)
  })

  it('is a W3C traceparent while an interaction is open, and nothing after', () => {
    expect(currentTraceparent()).toBeUndefined()
    const span = startInteraction('core', { name: 'command' })
    const header = currentTraceparent()
    expect(header).toBeDefined()
    const parsed = parseTraceparent(header)
    expect(parsed).toEqual({ traceId: span.traceId, parentSpanId: span.spanId, sampled: true })
    span.end()
    expect(currentTraceparent()).toBeUndefined()
  })

  it('leaves the newer interaction in charge when an older one ends under it', () => {
    // Two clicks in quick succession. Ending the first must not orphan the requests the second is
    // about to make.
    const first = startInteraction('core', { name: 'command' })
    const second = startInteraction('core', { name: 'nav.change' })
    first.end()
    expect(parseTraceparent(currentTraceparent())?.parentSpanId).toBe(second.spanId)
  })

  it('hangs a plain span under the open interaction', async () => {
    const interaction = startInteraction('core', { name: 'command' })
    emitEvent('agents', 'cache-miss')
    interaction.end()
    await flushTelemetry()
    const [batch] = posted
    const span = batch.find((record) => record.kind === 'span')
    expect(span?.kind === 'span' && span.traceId).toBe(interaction.traceId)
  })

  it('attributes one render transition across the current turn and two frame opportunities', async () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const interaction = startInteraction('agents', { name: 'agents.session.open' })
    const render = startRenderTransition('agents', 'agents.session.select', { 'snapshot.events': 120 })
    render.update({ 'snapshot.items': 45 })

    await Promise.resolve()
    expect(frames).toHaveLength(1)
    vi.advanceTimersByTime(8)
    frames.shift()!(8)
    vi.advanceTimersByTime(13)
    frames.shift()!(21)
    interaction.end()
    await flushTelemetry()

    const span = posted[0].find((record) => record.kind === 'span' && record.name === 'ui.render')
    expect(span?.kind).toBe('span')
    if (span?.kind !== 'span') return
    expect(span.parentSpanId).toBe(interaction.spanId)
    expect(span.attrs).toMatchObject({
      operation: 'agents.session.select',
      outcome: 'ready',
      'snapshot.events': 120,
      'snapshot.items': 45,
      'phase.turn_ms': 0,
      'phase.frame_wait_ms': 8,
      'phase.paint_wait_ms': 13,
    })
  })

  it('does not schedule render work without an open interaction', async () => {
    vi.useFakeTimers()
    const frame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', frame)
    startRenderTransition('core', 'background.refresh')
    await Promise.resolve()
    vi.runAllTimers()
    expect(frame).not.toHaveBeenCalled()
    await flushTelemetry()
    expect(posted).toEqual([])
  })
})

describe('flushing', () => {
  it('posts once the queue reaches five hundred records', async () => {
    start()
    setTelemetryEnabled(true)
    for (let index = 0; index < 500; index += 1) emitEvent('core', 'cache-miss')
    // Scheduled on a microtask, never run where the record was emitted: a slow poster must not add
    // its own latency to the click it is describing.
    expect(posted).toEqual([])
    await Promise.resolve()
    await Promise.resolve()
    expect(posted).toHaveLength(1)
    expect(posted[0]).toHaveLength(500)
  })

  it('posts on the five-second tick', async () => {
    vi.useFakeTimers()
    start()
    setTelemetryEnabled(true)
    emitEvent('core', 'cache-miss')
    expect(posted).toEqual([])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(posted).toHaveLength(1)
  })

  it('keeps the records when the post fails, so an offline node costs nothing', async () => {
    let attempts = 0
    start(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('node offline')
      posted.push([])
    })
    setTelemetryEnabled(true)
    emitEvent('core', 'cache-miss')
    await flushTelemetry()
    expect(posted).toEqual([])
    // Still held, and the next flush sends the same record.
    await flushTelemetry()
    expect(attempts).toBe(2)
  })

  it('stamps the runtime on every record and refuses one an emitter set', async () => {
    start()
    setTelemetryEnabled(true)
    emitEvent('agents', 'cache-miss', { runtime: 'node', owner: 'github', route: '/v2/core/tasks' })
    await flushTelemetry()
    const [only] = posted[0]
    expect(only.attrs).toEqual({ route: '/v2/core/tasks', owner: 'agents', runtime: 'renderer' })
  })

  it('throws away what it holds when the switch goes off', async () => {
    start()
    setTelemetryEnabled(true)
    emitEvent('core', 'cache-miss')
    setTelemetryEnabled(false)
    await flushTelemetry()
    expect(posted).toEqual([])
  })
})

describe('histograms', () => {
  it('folds a hot seam into one record per window', async () => {
    start()
    setTelemetryEnabled(true)
    for (let index = 0; index < 50; index += 1) measure('terminal', 'ws.inbound.term', () => index)
    await flushTelemetry()
    const [only] = posted[0]
    expect(only.kind).toBe('metric')
    expect(only.kind === 'metric' && only.name).toBe('ws.inbound.term')
    expect(only.kind === 'metric' && typeof only.value === 'object' && only.value.count).toBe(50)
    expect(only.attrs.owner).toBe('terminal')
  })

  it('keeps a row per label set, so a varying label does not report one value for every series', async () => {
    // The bug this replaced merged by owner and seam alone and kept the first sample's attributes,
    // so `tui.frame` reported the layout timings under every phase's name
    // (docs/telemetry.md § Hot seams are metrics).
    start()
    setTelemetryEnabled(true)
    for (const phase of ['layout', 'paint', 'flush']) {
      for (let index = 0; index < 4; index += 1) recordDuration('core', 'tui.frame', index + 1, { phase })
    }
    await flushTelemetry()
    const rows = posted[0].filter((record) => record.kind === 'metric')
    expect(rows.map((row) => row.attrs.phase).sort()).toEqual(['flush', 'layout', 'paint'])
    for (const row of rows) expect(row.kind === 'metric' && typeof row.value === 'object' && row.value.count).toBe(4)
  })

  it('sorts the label set, so two call sites in a different order are one row', async () => {
    start()
    setTelemetryEnabled(true)
    recordDuration('core', 'bridge.call', 1, { method: 'GET', 'node.id': 'n1' })
    recordDuration('core', 'bridge.call', 3, { 'node.id': 'n1', method: 'GET' })
    await flushTelemetry()
    const rows = posted[0].filter((record) => record.kind === 'metric')
    expect(rows).toHaveLength(1)
    expect(rows[0].kind === 'metric' && typeof rows[0].value === 'object' && rows[0].value.count).toBe(2)
  })

  it('past 200 series a sample keeps its count, loses its labels, and says so', async () => {
    start()
    setTelemetryEnabled(true)
    for (let index = 0; index < 250; index += 1) recordDuration('core', 'tree.apply', 1, { 'tree.id': `t${index}` })
    await flushTelemetry()
    const rows = posted[0].filter((record) => record.kind === 'metric')
    // 200 labelled rows, the unlabelled row the overflow folded into, and the truncation count.
    const labelled = rows.filter((row) => typeof row.attrs['tree.id'] === 'string')
    expect(labelled).toHaveLength(200)
    const overflow = rows.find((row) => row.name === 'tree.apply' && row.attrs['tree.id'] === undefined)
    expect(overflow?.kind === 'metric' && typeof overflow.value === 'object' && overflow.value.count).toBe(50)
    const truncated = rows.find((row) => row.name === 'telemetry.truncated')
    expect(truncated?.kind === 'metric' && truncated.value).toBe(50)
    // The totals stay exact whatever the cap did to the labels.
    const counted = rows
      .filter((row) => row.name === 'tree.apply')
      .reduce((total, row) => total + (row.kind === 'metric' && typeof row.value === 'object' ? row.value.count : 0), 0)
    expect(counted).toBe(250)
  })
})


it('does not resurrect an ended interaction when overlapping work finishes', () => {
  start()
  setTelemetryEnabled(true)
  const first = startInteraction('core', { name: 'first' })
  const second = startInteraction('core', { name: 'second' })
  first.end()
  second.end()
  expect(currentTraceparent()).toBeUndefined()
})

it('does not restore a failed post across an off/on consent change', async () => {
  let reject!: (error: Error) => void
  const post = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
  start(post)
  setTelemetryEnabled(true)
  emitEvent('core', 'before-off')
  const pending = flushTelemetry()
  setTelemetryEnabled(false)
  setTelemetryEnabled(true)
  reject(new Error('offline'))
  await pending
  await flushTelemetry()
  expect(post).toHaveBeenCalledOnce()
})


it('aggregates changing workload sizes without creating a series per size', async () => {
  start()
  setTelemetryEnabled(true)
  for (let i = 1; i <= 1000; i++) recordSample('agents', 'transcript.events', i)
  await flushTelemetry()
  const metrics = posted.flat().filter((r) => r.kind === 'metric')
  expect(metrics).toHaveLength(1)
  expect(metrics[0]).toMatchObject({ name: 'transcript.events', unit: '1', value: { count: 1000, max: 1000 } })
})

it('publishes operation context before work and immediately clears it when consent is revoked', () => {
  start()
  setTelemetryEnabled(true)
  const contexts: unknown[] = []
  const off = onTelemetryActivity(() => contexts.push(currentActivity()))
  const span = startInteraction('agents', { name: 'agents.session.open' })
  expect(contexts[0]).toMatchObject({ operation: 'agents.session.open', traceId: span.traceId })
  setTelemetryEnabled(false)
  expect(contexts.at(-1)).toBeNull()
  off()
})

it('does not emit a span begun before an off/on consent change', async () => {
  start()
  setTelemetryEnabled(true)
  const span = startInteraction('agents', { name: 'agents.session.open' })
  setTelemetryEnabled(false)
  setTelemetryEnabled(true)
  span.end()
  await flushTelemetry()
  expect(posted).toEqual([])
})

it('keeps slow work linked to its original interaction and bounds detailed samples', async () => {
  start()
  setTelemetryEnabled(true)
  const span = startInteraction('agents', { name: 'agents.session.open' })
  let now = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  for (let i = 0; i < 100; i++) measure('agents', 'transcript.project', () => { now += 200 })
  clock.mockRestore()
  span.end()
  await flushTelemetry()
  const slow = posted.flat().filter((r) => r.kind === 'span' && r.name === 'transcript.project')
  expect(slow).toHaveLength(20)
  expect(slow[0]).toMatchObject({ traceId: span.traceId, parentSpanId: span.spanId, durationMs: 200 })
  expect(posted.flat().find((r) => r.kind === 'metric' && r.name === 'transcript.project')).toMatchObject({ value: { count: 100 } })
})


it('summarizes repeated work per interaction without treating the frame monitor as work', async () => {
  start()
  setTelemetryEnabled(true)
  const span = startInteraction('agents', { name: 'agents.session.open' })
  for (let i = 0; i < 10; i++) recordSample('agents', 'agents.snapshot.load', 1)
  for (let i = 0; i < 100; i++) recordDuration('core', 'ui.frame.gap', 16)
  span.end()
  await flushTelemetry()
  const summary = posted.flat().filter((r) => r.kind === 'event' && r.name === 'ui.interaction.work')
  expect(summary).toHaveLength(1)
  expect(summary[0]).toMatchObject({ attrs: { traceId: span.traceId, operation: 'agents.snapshot.load', calls: 10 } })
})
