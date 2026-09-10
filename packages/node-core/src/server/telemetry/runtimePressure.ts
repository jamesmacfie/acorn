import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

/** Owned by the collector's lifecycle; never keeps a process alive. Values contain no heap data. */
export function startRuntimePressure(options: {
  enabled(): boolean
  duration(name: string, value: number): void
  gauge(name: string, value: number, unit: string): void
}): () => void {
  const delay = monitorEventLoopDelay({ resolution: 20 })
  let observing = false
  let previous = performance.eventLoopUtilization()
  let cpu = process.cpuUsage()
  let at = performance.now()
  const timer = setInterval(() => {
    if (!options.enabled()) {
      if (observing) delay.disable()
      observing = false
      return
    }
    const now = performance.now()
    const next = performance.eventLoopUtilization()
    const nextCpu = process.cpuUsage()
    if (observing && now - at < 30_000) {
      const elapsed = Math.max(1, now - at)
      options.duration('runtime.event_loop.p95', delay.percentile(95) / 1e6)
      options.duration('runtime.event_loop.max', delay.max / 1e6)
      options.gauge('runtime.event_loop.utilization', performance.eventLoopUtilization(next, previous).utilization, '1')
      options.gauge('runtime.cpu', (nextCpu.user - cpu.user + nextCpu.system - cpu.system) / (elapsed * 1000), '1')
      const memory = process.memoryUsage()
      options.gauge('runtime.memory.rss', memory.rss, 'byte')
      options.gauge('runtime.memory.heap', memory.heapUsed, 'byte')
    }
    if (!observing) delay.enable()
    observing = true
    delay.reset()
    previous = next
    cpu = nextCpu
    at = now
  }, 5000)
  timer.unref?.()
  return () => { clearInterval(timer); delay.disable() }
}
