import { afterEach, expect, it, vi } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import {
  _resetClientTelemetry,
  flushTelemetry,
  setTelemetryEnabled,
  startClientTelemetry,
  startInteraction,
  startSpan,
} from './emitter'
import { noteScreenWork, startResponsivenessMonitor } from './responsiveness'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  _resetClientTelemetry()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it('sends operation context synchronously and disarms on blur and consent revocation', () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const send = vi.fn()
  startClientTelemetry({ runtime: 'renderer', post: async () => {} })
  dispose = startResponsivenessMonitor(send)
  expect(send).not.toHaveBeenCalled()
  setTelemetryEnabled(true)
  const span = startInteraction('agents', { name: 'agents.session.open' })
  expect(send).toHaveBeenLastCalledWith({
    active: true,
    activity: { owner: 'agents', operation: 'agents.session.open', traceId: span.traceId, spanId: span.spanId },
  })
  focused.mockReturnValue(false)
  window.dispatchEvent(new Event('blur'))
  expect(send).toHaveBeenLastCalledWith({ active: false, activity: null })
  focused.mockReturnValue(true)
  window.dispatchEvent(new Event('focus'))
  setTelemetryEnabled(false)
  expect(send).toHaveBeenLastCalledWith({ active: false, activity: null })
  const count = send.mock.calls.length
  vi.advanceTimersByTime(10_000)
  expect(send).toHaveBeenCalledTimes(count)
})
it('a broken diagnostic transport cannot prevent an interaction', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  startClientTelemetry({ runtime: 'renderer', post: async () => {} })
  setTelemetryEnabled(true)
  expect(() => {
    dispose = startResponsivenessMonitor(() => {
      throw new Error('closed socket')
    })
  }).not.toThrow()
  expect(() => startInteraction('agents', { name: 'agents.session.open' })).not.toThrow()
})

// A display the test drives: each tick moves the clock one 60 Hz frame and runs the frames requested
// before it, as a compositor would. Counting requests is counting how often an idle window is woken.
function frameClock() {
  let pending = new Map<number, FrameRequestCallback>()
  let nextId = 0
  let requests = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    requests += 1
    pending.set(++nextId, callback)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id))
  const paint = () => {
    const due = pending
    pending = new Map()
    for (const callback of due.values()) callback(performance.now())
  }
  return {
    requests: () => requests,
    paint,
    run(ms: number) {
      for (let elapsed = 0; elapsed < ms; elapsed += 16) {
        vi.advanceTimersByTime(16)
        paint()
      }
    },
  }
}

// The flush timer posts a batch every few seconds, so a histogram's samples are spread over batches.
// A flush skips while the previous post is unsettled, so settle it before the last one.
async function postedHistogram(posted: TelemetryRecord[][], name: string) {
  await vi.advanceTimersByTimeAsync(0)
  await flushTelemetry()
  const total = { count: 0, max: 0 }
  for (const record of posted.flat()) {
    if (record.kind !== 'metric' || record.name !== name || typeof record.value !== 'object') continue
    total.count += record.value.count
    total.max = Math.max(total.max, record.value.max)
  }
  return total
}

function armedMonitor(activeCache?: Parameters<typeof startResponsivenessMonitor>[1]) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const posted: TelemetryRecord[][] = []
  startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push([...records]) })
  setTelemetryEnabled(true)
  const clock = frameClock()
  dispose = startResponsivenessMonitor(() => {}, activeCache)
  return { clock, posted }
}

it('names what else was running when the window stalled', async () => {
  const { posted } = armedMonitor(() => ({
    client: { isFetching: () => 2 } as never,
    persistence: { saving: () => true },
  }))
  noteScreenWork('agent')
  noteScreenWork('binary')
  noteScreenWork('agent')
  // The next one-second tick runs 400 ms late.
  vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1_400)
  vi.advanceTimersByTime(1_000)
  await vi.advanceTimersByTimeAsync(0)
  await flushTelemetry()
  const stall = posted.flat().find((record) => record.kind === 'event' && record.name === 'ui.stall')
  expect(stall?.attrs).toMatchObject({
    durationMs: 400,
    inbound: 'agent,binary',
    'cache.saving': true,
    'queries.fetching': 2,
  })
})

it('stops requesting frames in an idle window and keeps checking the event loop', async () => {
  const { clock, posted } = armedMonitor()
  clock.run(60_000)
  // Arming opens one two-second window, about 125 frames, and nothing after it.
  expect(clock.requests()).toBeGreaterThan(100)
  expect(clock.requests()).toBeLessThan(140)
  const afterFirstMinute = clock.requests()
  clock.run(60_000)
  expect(clock.requests()).toBe(afterFirstMinute)
  expect((await postedHistogram(posted, 'ui.event_loop.delay')).count).toBeGreaterThanOrEqual(119)
})

it('samples frame gaps again after input, a socket frame, or telemetry activity', async () => {
  const { clock, posted } = armedMonitor()
  clock.run(5_000)
  const wakes: Array<[string, () => void]> = [
    ['wheel', () => document.body.dispatchEvent(new WheelEvent('wheel'))],
    // Scroll doesn't bubble, so this proves the window listener captures it.
    ['scroll', () => document.body.appendChild(document.createElement('div')).dispatchEvent(new Event('scroll'))],
    ['key', () => document.body.dispatchEvent(new KeyboardEvent('keydown'))],
    ['socket frame', () => noteScreenWork()],
    ['interaction', () => startInteraction('agents', { name: 'agents.session.open' }).end()],
  ]
  for (const [name, wake] of wakes) {
    const before = clock.requests()
    wake()
    clock.run(5_000)
    expect(clock.requests() - before, name).toBeGreaterThan(100)
    expect(clock.requests() - before, name).toBeLessThan(140)
  }
  expect((await postedHistogram(posted, 'ui.frame.gap')).count).toBeGreaterThan(500)
})

it('records the gap of a frame that lands after its sampling window closed', async () => {
  const { clock, posted } = armedMonitor()
  clock.run(1_984)
  // The renderer stalls for three seconds with a frame already requested.
  vi.advanceTimersByTime(3_000)
  clock.paint()
  expect((await postedHistogram(posted, 'ui.frame.gap')).max).toBeGreaterThanOrEqual(3_000)
  const settled = clock.requests()
  clock.run(10_000)
  expect(clock.requests()).toBe(settled)
})

it('requests no frames while telemetry is off', () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  startClientTelemetry({ runtime: 'renderer', post: async () => {} })
  const clock = frameClock()
  dispose = startResponsivenessMonitor(() => {})
  document.body.dispatchEvent(new WheelEvent('wheel'))
  noteScreenWork()
  clock.run(10_000)
  expect(clock.requests()).toBe(0)
})

it('marks a span that crossed a hidden window or a sleep as suspended', async () => {
  const { posted } = armedMonitor()
  const visibility = vi.spyOn(document, 'visibilityState', 'get')
  const hidden = startSpan('core', { name: 'hidden' })
  vi.advanceTimersByTime(500)
  visibility.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  hidden.end()
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  vi.advanceTimersByTime(500)
  const slept = startSpan('core', { name: 'slept' })
  // The Mac sleeps for a minute, so the next one-second tick runs a minute late.
  vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 60_000)
  vi.advanceTimersByTime(1_000)
  slept.end()
  vi.advanceTimersByTime(1)
  startSpan('core', { name: 'awake' }).end()
  await vi.advanceTimersByTimeAsync(0)
  await flushTelemetry()
  const flags = Object.fromEntries(
    posted
      .flat()
      .filter((record) => record.kind === 'span')
      .map((record) => [record.name, record.attrs.suspended]),
  )
  expect(flags).toEqual({ hidden: true, slept: true, awake: false })
})
