import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks'

const INTERVAL_MS = 5000
// Well past the histogram's 20 ms resolution and ordinary scheduling noise.
const SUSPEND_MS = 1000

/** What the sampler reads. Tests pass fakes; the defaults are the process's own. */
export type PressureSources = {
  /** Monotonic milliseconds. */
  now(): number
  /** Cumulative idle and active loop time in milliseconds, as `performance.eventLoopUtilization()`. */
  loop(): { idle: number; active: number }
  delay: Pick<IntervalHistogram, 'enable' | 'disable' | 'reset' | 'percentile' | 'max'>
}

/** Owned by the collector's lifecycle; never keeps a process alive. Values contain no heap data. */
export function startRuntimePressure(options: {
  enabled(): boolean
  duration(name: string, value: number): void
  gauge(name: string, value: number, unit: string): void
  sources?: PressureSources
}): () => void {
  const { now, loop, delay } = options.sources ?? {
    now: () => performance.now(),
    loop: () => performance.eventLoopUtilization(),
    delay: monitorEventLoopDelay({ resolution: 20 }),
  }
  let observing = false
  let previous = loop()
  let cpu = process.cpuUsage()
  let at = now()
  const timer = setInterval(() => {
    if (!options.enabled()) {
      if (observing) delay.disable()
      observing = false
      return
    }
    const next = loop()
    const nextCpu = process.cpuUsage()
    const nextAt = now()
    if (observing) {
      const elapsed = Math.max(1, nextAt - at)
      const idle = next.idle - previous.idle
      const active = next.active - previous.active
      const max = delay.max / 1e6
      // Only running code can hold the loop, so a stall longer than the window's active time is
      // the process not being scheduled: sleep, a dark wake, or swapping. On macOS the monotonic
      // clock keeps running through sleep, so the histogram would count all of it. Idle time past
      // the interval is the same thing seen from the other side, when the histogram missed it.
      const suspended = Math.max(max - active, idle - INTERVAL_MS)
      if (suspended > SUSPEND_MS) {
        options.duration('runtime.suspended', suspended)
      } else {
        options.duration('runtime.event_loop.p95', delay.percentile(95) / 1e6)
        options.duration('runtime.event_loop.max', max)
        options.gauge('runtime.event_loop.utilization', active / Math.max(1, idle + active), '1')
        options.gauge('runtime.cpu', (nextCpu.user - cpu.user + nextCpu.system - cpu.system) / (elapsed * 1000), '1')
      }
      const memory = process.memoryUsage()
      options.gauge('runtime.memory.rss', memory.rss, 'byte')
      options.gauge('runtime.memory.heap', memory.heapUsed, 'byte')
    }
    if (!observing) delay.enable()
    observing = true
    delay.reset()
    previous = next
    cpu = nextCpu
    at = nextAt
  }, INTERVAL_MS)
  timer.unref?.()
  return () => { clearInterval(timer); delay.disable() }
}
