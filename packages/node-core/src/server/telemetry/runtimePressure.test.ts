import { afterEach, expect, it, vi } from 'vitest'
import { startRuntimePressure } from './runtimePressure'

afterEach(() => vi.useRealTimers())
it('samples only while collecting and releases its timer on disposal', () => {
  vi.useFakeTimers()
  let enabled = false
  const duration = vi.fn()
  const gauge = vi.fn()
  const stop = startRuntimePressure({ enabled: () => enabled, duration, gauge })
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
  } finally { stop() }
  expect(vi.getTimerCount()).toBe(0)
})
