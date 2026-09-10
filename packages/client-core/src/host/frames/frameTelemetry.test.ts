import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { _resetClientTelemetry, flushTelemetry, setTelemetryEnabled, startClientTelemetry, startInteraction } from '../../infra/telemetry/emitter'
import { createFrameBridge, type FrameBinding, type FrameServices } from './broker'

// The frame's telemetry verb, driven over a real MessageChannel through the real broker, for the
// reason broker.test.ts gives: the thing under test is what happens when untrusted data arrives on
// a port, and a fake that only delivers well-formed messages would test the protocol's happy path
// rather than the checking (docs/telemetry.md § A frame's own records).

const BINDING: FrameBinding = {
  pluginId: 'board',
  surface: 'board',
  target: 'pane',
  nodeId: 'node-a',
  api: [],
  events: [],
  panes: [],
  claimsKeys: [],
}

const services = (): FrameServices => ({
  fetch: vi.fn(async () => ({ ok: true, status: 200, body: null })),
  fetchBytes: vi.fn(async () => ({ ok: true as const, status: 200, bytes: new Uint8Array(), type: '', filename: null })),
  subscribe: vi.fn(() => vi.fn()),
  stateGet: vi.fn(() => undefined),
  stateSet: vi.fn(async () => {}),
  toast: vi.fn(),
  copy: vi.fn(),
  openPane: vi.fn(),
  openUrl: vi.fn(),
  frameHasFocus: vi.fn(() => true),
  importerDone: vi.fn(),
  importerClose: vi.fn(),
  keydown: vi.fn(),
})

let posted: TelemetryRecord[]
let channel: MessageChannel
let dispose: () => void
let misbehaved: string[]

const open = () => {
  channel = new MessageChannel()
  misbehaved = []
  const bridge = createFrameBridge({
    port: channel.port1 as unknown as MessagePort,
    binding: BINDING,
    services: services(),
    context: { surface: 'board', target: 'pane', nodeId: 'node-a', theme: 'dark', style: 'terminal' },
    onMisbehaving: (reason) => void misbehaved.push(reason),
  })
  dispose = () => {
    bridge.dispose()
    channel.port2.close()
  }
}

/**
 * Let the port deliver, then hand the queue over. Records reach the poster on the emitter's own
 * flush, so both halves have to happen before an assertion.
 *
 * The broker's own `bridge.message.*` histogram rides the same flush, because a telemetry message
 * is a bridge message like any other and is timed like one. Dropped here so each test reads as
 * what the frame asked for.
 */
const collected = async (): Promise<TelemetryRecord[]> => {
  await new Promise((resolve) => setTimeout(resolve, 5))
  await flushTelemetry()
  return posted.filter((record) => !(record.kind === 'metric' && record.name.startsWith('bridge.message.')))
}

beforeEach(() => {
  _resetClientTelemetry()
  posted = []
  startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push(...records) })
  setTelemetryEnabled(true)
  open()
})

afterEach(() => {
  dispose()
  _resetClientTelemetry()
})

describe('a frame emitting telemetry', () => {
  it('files an event under the binding, whatever the message says', async () => {
    // The whole security property in one assertion: the frame names a plugin and the host ignores
    // it, because the owner comes from the binding the host made.
    channel.port2.postMessage({ kind: 'telemetry', record: { type: 'event', name: 'cache-miss', attrs: { owner: 'github', resource: 'issues' } } })
    const records = await collected()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'event', name: 'cache-miss' })
    expect(records[0].attrs).toMatchObject({ owner: 'board', resource: 'issues', seam: 'frame.telemetry' })
  })

  it('takes a count, a gauge and an error', async () => {
    channel.port2.postMessage({ kind: 'telemetry', record: { type: 'count', name: 'items-synced', value: 12 } })
    channel.port2.postMessage({ kind: 'telemetry', record: { type: 'gauge', name: 'queue-depth', value: 3 } })
    channel.port2.postMessage({ kind: 'telemetry', record: { type: 'error', name: 'UpstreamError', message: 'rate limited' } })
    const records = await collected()
    expect(records.map((record) => record.kind)).toEqual(['metric', 'metric', 'error'])
    expect(records.every((record) => record.attrs.owner === 'board')).toBe(true)
  })

  it('hangs a span under the open interaction and mints the ids itself', async () => {
    const interaction = startInteraction('core', { name: 'command' })
    channel.port2.postMessage({ kind: 'telemetry', record: { type: 'span', name: 'draw-chart', durationMs: 40, status: 'error' } })
    await new Promise((resolve) => setTimeout(resolve, 5))
    interaction.end()
    const records = await collected()
    const span = records.find((record) => record.kind === 'span' && record.name === 'draw-chart')
    expect(span).toMatchObject({ kind: 'span', durationMs: 40, status: 'error', traceId: interaction.traceId, parentSpanId: interaction.spanId })
    // A frame cannot name a trace, so the id is one the host minted and not one the frame sent.
    expect(span?.kind === 'span' && span.spanId).not.toBe(interaction.spanId)
  })

  it('writes a log line under the plugin id', async () => {
    channel.port2.postMessage({ kind: 'telemetry', record: { type: 'log', level: 'warn', message: 'upstream is slow' } })
    const records = await collected()
    expect(records[0]).toMatchObject({ kind: 'log', level: 'warn', logger: 'board', body: 'upstream is slow' })
  })

  it('drops a malformed record instead of answering it', async () => {
    // No reply either way: the verb has no id, so there is nothing to answer and nothing a frame
    // could do with the answer.
    const answers: unknown[] = []
    channel.port2.onmessage = (event: MessageEvent) => void answers.push(event.data)
    for (const record of [null, { type: 'nope', name: 'x' }, { type: 'event' }, { type: 'count', name: 'x', value: Number.NaN }, { type: 'log', level: 'shout', message: 'x' }]) {
      channel.port2.postMessage({ kind: 'telemetry', record })
    }
    const records = await collected()
    expect(records).toEqual([])
    expect(answers.filter((answer) => answer && typeof answer === 'object' && 'id' in answer)).toEqual([])
  })

  it('keeps only the scalars out of an attribute map', async () => {
    channel.port2.postMessage({
      kind: 'telemetry',
      record: { type: 'event', name: 'sync', attrs: { rows: 4, ok: true, note: 'fine', body: { secret: 1 }, list: [1, 2] } },
    })
    const records = await collected()
    expect(records[0].attrs).toMatchObject({ rows: 4, ok: true, note: 'fine' })
    expect(records[0].attrs.body).toBeUndefined()
    expect(records[0].attrs.list).toBeUndefined()
  })

  it('kills a frame that emits in a loop', async () => {
    // The rate window is the answer to a plugin whose telemetry is the bug: it costs the frame its
    // port before the collector sees a thousand records.
    for (let index = 0; index < 1100; index += 1) {
      channel.port2.postMessage({ kind: 'telemetry', record: { type: 'count', name: 'tick', value: 1 } })
    }
    for (let tick = 0; tick < 400 && misbehaved.length === 0; tick += 1) await new Promise((resolve) => setTimeout(resolve, 1))
    expect(misbehaved[0]).toContain('bridge messages')
  })
})
