import type { Logger, PluginTelemetry, TelemetryBatch, TelemetryRecord } from '@acorn/plugin-api/node'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDsn } from './dsn'
import { createExporter, type ExporterDeps, type SentryTarget } from './exporter'
import { DEFAULT_SETTINGS } from '../shared/settings'

const TARGET: SentryTarget = { dsn: parseDsn('https://abc123@o42.ingest.us.sentry.io/1234567')!, environment: 'development' }
const NOW = 1_700_000_000_000

const failure = (name: string): TelemetryRecord => ({
  kind: 'error', at: NOW, name, message: 'boom', level: 'error', handled: true, attrs: { owner: 'core' },
})
const line = (body: string): TelemetryRecord => ({
  kind: 'log', at: NOW, level: 'info', logger: 'server', body, attrs: { owner: 'core' },
})
const batch = (records: TelemetryRecord[]): TelemetryBatch => ({ node: 'node-1', version: '0.1.0', records })

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
const telemetry = (): PluginTelemetry => ({
  event: vi.fn(), count: vi.fn(), gauge: vi.fn(), error: vi.fn(),
  measure: vi.fn((_name, run) => run()), startSpan: vi.fn(),
} as unknown as PluginTelemetry)

type Harness = { deps: ExporterDeps; fetch: ReturnType<typeof vi.fn>; slept: number[]; now: { value: number } }

function harness(over: Partial<ExporterDeps> = {}): Harness {
  const now = { value: NOW }
  const slept: number[] = []
  const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
  const deps: ExporterDeps = {
    fetch: fetchImpl as unknown as typeof fetch,
    now: () => now.value,
    newId: () => 'f'.repeat(32),
    target: async () => TARGET,
    settings: async () => DEFAULT_SETTINGS,
    log: logger(),
    telemetry: telemetry(),
    client: 'acorn/1',
    sdk: { name: 'acorn.sentry-telemetry', version: '0.1.0' },
    sleep: async (ms) => { slept.push(ms) },
    ...over,
  }
  return { deps, fetch: fetchImpl, slept, now }
}

const itemTypeOf = (body: string): string => JSON.parse(body.split('\n')[1]).type

describe('the exporter', () => {
  let world: Harness

  beforeEach(() => {
    world = harness()
  })

  it('sends nothing when nothing is connected', async () => {
    const offline = harness({ target: async () => null })
    const exporter = createExporter(offline.deps)
    exporter.accept(batch([failure('TypeError')]))
    await exporter.settled()
    expect(offline.fetch).not.toHaveBeenCalled()
  })

  it('turns a batch into one envelope per item type', async () => {
    const exporter = createExporter(world.deps)
    exporter.accept(batch([failure('TypeError'), line('ready')]))
    await exporter.settled()

    expect(world.fetch).toHaveBeenCalledTimes(2)
    const bodies = world.fetch.mock.calls.map((call) => String((call[1] as RequestInit).body))
    expect(bodies.map(itemTypeOf)).toEqual(['event', 'log'])
  })

  it('returns from accept without waiting for the post', () => {
    // The collector calls a sink on its own timer and awaits nothing, so this has to be true or a
    // slow Sentry adds its latency to the flush of the thing being measured.
    let resolve = () => {}
    const slow = harness({ fetch: (async () => {
      await new Promise<void>((done) => { resolve = done })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch })
    const exporter = createExporter(slow.deps)
    expect(() => exporter.accept(batch([failure('TypeError')]))).not.toThrow()
    resolve()
  })

  it('drops the rate-limited category and keeps the others', async () => {
    // Sentry answers a 429 naming `error`. The log envelope behind it still goes.
    world.fetch.mockImplementationOnce(async () =>
      new Response(null, { status: 429, headers: { 'x-sentry-rate-limits': '60:error:organization' } }))
    const exporter = createExporter(world.deps)
    exporter.accept(batch([failure('TypeError'), line('ready')]))
    await exporter.settled()

    expect(world.fetch.mock.calls.map((call) => itemTypeOf(String((call[1] as RequestInit).body)))).toEqual(['event', 'log'])

    // A second batch of both: the error is dropped before it is posted and the log is not.
    world.fetch.mockClear()
    exporter.accept(batch([failure('TypeError'), line('again')]))
    await exporter.settled()
    expect(world.fetch.mock.calls.map((call) => itemTypeOf(String((call[1] as RequestInit).body)))).toEqual(['log'])
    expect(world.deps.telemetry.count).toHaveBeenCalledWith('sentry.dropped', 1, { reason: 'rate-limited', category: 'error' })
  })

  it('sends the category again once the window has passed', async () => {
    world.fetch.mockImplementationOnce(async () =>
      new Response(null, { status: 429, headers: { 'x-sentry-rate-limits': '60:error:organization' } }))
    const exporter = createExporter(world.deps)
    exporter.accept(batch([failure('TypeError')]))
    await exporter.settled()

    world.now.value = NOW + 61_000
    world.fetch.mockClear()
    exporter.accept(batch([failure('TypeError')]))
    await exporter.settled()
    expect(world.fetch).toHaveBeenCalledOnce()
  })

  it('backs off from a second to two minutes while the network is down, then delivers', async () => {
    let attempts = 0
    const flaky = harness({
      fetch: (async () => {
        attempts += 1
        if (attempts <= 9) throw new Error('ENOTFOUND')
        return new Response(null, { status: 200 })
      }) as unknown as typeof fetch,
    })
    const exporter = createExporter(flaky.deps)
    exporter.accept(batch([failure('TypeError')]))
    await exporter.settled()

    expect(flaky.slept).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 120_000, 120_000])
    expect(attempts).toBe(10)
  })

  it('gives up on a 400 rather than retrying a malformed envelope forever', async () => {
    world.fetch.mockImplementation(async () => new Response(null, { status: 400, headers: { 'x-sentry-error': 'invalid item header' } }))
    const exporter = createExporter(world.deps)
    exporter.accept(batch([failure('TypeError')]))
    await exporter.settled()

    expect(world.fetch).toHaveBeenCalledOnce()
    expect(world.deps.log.warn).toHaveBeenCalledWith('Sentry refused an envelope', expect.objectContaining({ status: 400, detail: 'invalid item header' }))
  })

  it('holds two hundred envelopes and drops the oldest past that', async () => {
    // The network never answers, so nothing leaves the queue while it fills.
    const stuck = harness({
      fetch: (() => new Promise<Response>(() => {})) as unknown as typeof fetch,
      sleep: async () => {},
    })
    const exporter = createExporter(stuck.deps)
    exporter.accept(batch(Array.from({ length: 250 }, (_, index) => failure(`E${index}`))))
    // Only the conversions are awaited; the first post is still hanging.
    await new Promise((resolve) => setImmediate(resolve))

    const dropped = (stuck.deps.telemetry.count as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((call) => call[2]?.reason === 'queue-full')
      .reduce((total, call) => total + (call[1] as number), 0)
    expect(dropped).toBe(50)
  })

  it('stops on dispose', async () => {
    const exporter = createExporter(world.deps)
    exporter.dispose()
    exporter.accept(batch([failure('TypeError')]))
    await exporter.settled()
    expect(world.fetch).not.toHaveBeenCalled()
  })
})


it('drops queued retries when the connection or consent disappears', async () => {
  let target: SentryTarget | null = TARGET
  const world = harness({ target: async () => target, sleep: async () => { target = null } })
  world.fetch.mockRejectedValue(new Error('offline'))
  const exporter = createExporter(world.deps)
  exporter.accept(batch([failure('before-disconnect')]))
  await exporter.settled()
  expect(world.fetch).toHaveBeenCalledOnce()
})

it('does not drop a newer envelope when the in-flight one was evicted', async () => {
  let finish!: (response: Response) => void
  const world = harness()
  world.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
  const exporter = createExporter(world.deps)
  exporter.accept(batch([failure('first')]))
  await new Promise((resolve) => setImmediate(resolve))
  exporter.accept(batch(Array.from({ length: 201 }, (_, i) => failure(`new-${i}`))))
  await new Promise((resolve) => setImmediate(resolve))
  finish(new Response(null, { status: 200 }))
  await exporter.settled()
  expect(world.fetch).toHaveBeenCalledTimes(201)
})

it('bounds batches waiting for a stalled connection lookup', async () => {
  let finish!: (target: SentryTarget | null) => void
  const world = harness({ target: () => new Promise((resolve) => { finish = resolve }) })
  const exporter = createExporter(world.deps)
  for (let i = 0; i < 250; i += 1) exporter.accept(batch([failure('queued')]))
  await Promise.resolve()
  expect(world.deps.telemetry.count).toHaveBeenCalledWith('sentry.dropped', 1, { reason: 'conversion-full' })
  exporter.dispose()
  finish(null)
  await exporter.settled()
  expect(world.fetch).not.toHaveBeenCalled()
})
