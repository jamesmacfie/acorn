import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSwapUsage, startRuntimePressure } from './runtimePressure'

afterEach(() => vi.useRealTimers())
it('samples only while collecting and releases its timer on disposal', () => {
  vi.useFakeTimers()
  let enabled = false
  const duration = vi.fn()
  const gauge = vi.fn()
  const stop = startRuntimePressure({ enabled: () => enabled, duration, suspended: duration, gauge })
  try {
    vi.advanceTimersByTime(10_000)
    expect(gauge).not.toHaveBeenCalled()
    enabled = true
    vi.advanceTimersByTime(10_000)
    expect(gauge).toHaveBeenCalledWith('runtime.memory.rss', expect.any(Number), 'byte')
    expect(duration).toHaveBeenCalledWith('runtime.event_loop.max', expect.any(Number))
    gauge.mockClear()
    enabled = false
    vi.advanceTimersByTime(10_000)
    expect(gauge).not.toHaveBeenCalled()
  } finally {
    stop()
  }
  expect(vi.getTimerCount()).toBe(0)
})

it('reports the first window after it starts, so a boot that arms it is measured', () => {
  vi.useFakeTimers()
  const duration = vi.fn()
  const stop = startRuntimePressure({ enabled: () => true, duration, suspended: duration, gauge: () => {} })
  try {
    vi.advanceTimersByTime(5_000)
    expect(duration).toHaveBeenCalledWith('runtime.event_loop.max', expect.any(Number))
  } finally {
    stop()
  }
})

describe('a window the process spent suspended', () => {
  // A fake clock, loop and histogram. Each window says how long it took, how much of that the loop
  // was busy or idle, and the longest gap the delay timer saw, all in milliseconds.
  function sampler() {
    vi.useFakeTimers()
    let clock = 0
    const loop = { idle: 0, active: 0 }
    let max = 20
    const durations = new Map<string, number[]>()
    const stop = startRuntimePressure({
      enabled: () => true,
      duration: (name, value) => durations.set(name, [...(durations.get(name) ?? []), value]),
      suspended: (value) => durations.set('runtime.suspended', [...(durations.get('runtime.suspended') ?? []), value]),
      gauge: () => {},
      sources: {
        now: () => clock,
        loop: () => ({ ...loop }),
        delay: {
          enable: () => true,
          disable: () => true,
          reset() {
            max = 20
          },
          percentile: () => 20e6,
          get max() {
            return max * 1e6
          },
        },
      },
    })
    const window = (w: { gap: number; active: number; max: number }) => {
      clock += w.gap
      loop.active += w.active
      loop.idle += w.gap - w.active
      max = w.max
      vi.advanceTimersByTime(5000)
    }
    // The first window's numbers are whatever the fake started with.
    window({ gap: 5000, active: 5, max: 20 })
    durations.clear()
    return { window, durations, stop }
  }

  it('reports ordinary windows as they are', () => {
    const { window, durations, stop } = sampler()
    window({ gap: 5000, active: 40, max: 22 })
    window({ gap: 5002, active: 4000, max: 180 })
    stop()
    expect(durations.get('runtime.event_loop.max')).toEqual([22, 180])
    expect(durations.has('runtime.suspended')).toBe(false)
  })

  it('reports a real block, because the loop was busy for all of it', () => {
    const { window, durations, stop } = sampler()
    window({ gap: 20_000, active: 15_050, max: 15_020 })
    // Longer than thirty seconds, and still counted rather than thrown away as a probable sleep.
    window({ gap: 45_000, active: 40_010, max: 40_000 })
    stop()
    expect(durations.get('runtime.event_loop.max')).toEqual([15_020, 40_000])
    expect(durations.has('runtime.suspended')).toBe(false)
  })

  it('counts a freeze inside the window as suspended, not as delay', () => {
    const { window, durations, stop } = sampler()
    // The process was held for three seconds and the interval timer was not yet late.
    window({ gap: 5000, active: 10, max: 3020 })
    stop()
    expect(durations.has('runtime.event_loop.max')).toBe(false)
    expect(durations.has('runtime.event_loop.p95')).toBe(false)
    expect(durations.get('runtime.suspended')).toEqual([3010])
  })

  it('counts a sleep the histogram missed from the idle time past the interval', () => {
    const { window, durations, stop } = sampler()
    // The sampler's own timer ran first on wake, so the histogram never saw the gap.
    window({ gap: 3_605_000, active: 20, max: 20 })
    window({ gap: 5000, active: 30, max: 21 })
    stop()
    expect(durations.get('runtime.suspended')).toEqual([3_599_980])
    expect(durations.get('runtime.event_loop.max')).toEqual([21])
  })
})

describe('the host beside the process', () => {
  it('reports load and free memory every window, and swap at most once a minute', async () => {
    vi.useFakeTimers()
    let clock = 0
    const gauges: Array<[string, number, Record<string, unknown> | undefined]> = []
    const swapUsed = vi.fn(async () => 2 ** 30)
    const stop = startRuntimePressure({
      enabled: () => true,
      duration: () => {},
      suspended: () => {},
      gauge: (name, value, _unit, attrs) => void gauges.push([name, value, attrs]),
      sources: {
        now: () => clock,
        loop: () => ({ idle: clock, active: 0 }),
        delay: { enable: () => true, disable: () => true, reset() {}, percentile: () => 0, max: 0 },
        host: { load: () => 3.5, cpus: () => 10, freeMemory: () => 512, swapUsed },
      },
    })
    try {
      for (let index = 0; index < 14; index += 1) {
        clock += 5_000
        await vi.advanceTimersByTimeAsync(5_000)
      }
    } finally {
      stop()
    }
    expect(gauges).toContainEqual(['host.load.1m', 3.5, { 'host.cpus': 10 }])
    expect(gauges).toContainEqual(['host.memory.free', 512, undefined])
    expect(gauges).toContainEqual(['host.swap.used', 2 ** 30, undefined])
    // Thirteen observed windows, a minute apart at the first and the thirteenth.
    expect(swapUsed).toHaveBeenCalledTimes(2)
  })

  it('reads swap in use from sysctl', () => {
    expect(parseSwapUsage('total = 11264.00M  used = 10159.12M  free = 1104.88M  (encrypted)')).toBe(
      Math.round(10159.12 * 2 ** 20),
    )
    expect(parseSwapUsage('nonsense')).toBeNull()
  })
})
