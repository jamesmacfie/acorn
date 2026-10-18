import { execFile } from 'node:child_process'
import { availableParallelism, freemem, loadavg } from 'node:os'
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks'
import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'

const INTERVAL_MS = 5000
// Well past the histogram's 20 ms resolution and ordinary scheduling noise.
const SUSPEND_MS = 1000
// Reading swap spawns a process, so it's read far less often than the rest.
const SWAP_EVERY_MS = 60_000

/** The Mac as a whole, beside Acorn's own process, so a slowdown can be told apart from a busy
 *  machine (docs/telemetry/diagnosis.md § Is it Acorn or the Mac?). */
type HostSources = {
  load(): number
  cpus(): number
  freeMemory(): number
  /** Bytes of swap in use, or null where it can't be read. */
  swapUsed(): Promise<number | null>
}

const UNITS: Record<string, number> = { K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40 }

/** `used = 10159.12M` from `sysctl -n vm.swapusage`, in bytes. */
export function parseSwapUsage(text: string): number | null {
  const match = /used = ([\d.]+)([KMGT])/.exec(text)
  return match ? Math.round(Number(match[1]) * UNITS[match[2]!]!) : null
}

const readSwap = (): Promise<number | null> =>
  process.platform !== 'darwin'
    ? Promise.resolve(null)
    : new Promise((resolve) =>
        execFile('sysctl', ['-n', 'vm.swapusage'], { timeout: 2_000 }, (error, stdout) =>
          resolve(error ? null : parseSwapUsage(stdout)),
        ),
      )

const HOST: HostSources = {
  load: () => loadavg()[0]!,
  cpus: availableParallelism,
  freeMemory: freemem,
  swapUsed: readSwap,
}

/** What the sampler reads. Tests pass fakes; the defaults are the process's own. */
export type PressureSources = {
  /** Monotonic milliseconds. */
  now(): number
  /** Cumulative idle and active loop time in milliseconds, as `performance.eventLoopUtilization()`. */
  loop(): { idle: number; active: number }
  delay: Pick<IntervalHistogram, 'enable' | 'disable' | 'reset' | 'percentile' | 'max'>
  host?: HostSources
}

/** Owned by the collector's lifecycle; never keeps a process alive. Values contain no heap data. */
export function startRuntimePressure(options: {
  enabled(): boolean
  duration(name: string, value: number): void
  /** A window the process spent suspended, in milliseconds, in place of the numbers it distorts. */
  suspended(ms: number): void
  gauge(name: string, value: number, unit: string, attrs?: TelemetryAttrs): void
  sources?: PressureSources
}): () => void {
  const host = options.sources?.host ?? HOST
  const { now, loop, delay } = options.sources ?? {
    now: () => performance.now(),
    loop: () => performance.eventLoopUtilization(),
    delay: monitorEventLoopDelay({ resolution: 20 }),
  }
  // Observing from the start rather than from the first tick, so the first window covers the five
  // seconds after a sink subscribes. On a Node that is its boot and the start of its cleanup, which a
  // window opened a tick later would miss. The first tick turns it off again if nothing is collecting.
  delay.enable()
  let observing = true
  let previous = loop()
  let cpu = process.cpuUsage()
  let at = now()
  let swapAt = -Infinity
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
        options.suspended(suspended)
      } else {
        options.duration('runtime.event_loop.p95', delay.percentile(95) / 1e6)
        options.duration('runtime.event_loop.max', max)
        options.gauge('runtime.event_loop.utilization', active / Math.max(1, idle + active), '1')
        options.gauge('runtime.cpu', (nextCpu.user - cpu.user + nextCpu.system - cpu.system) / (elapsed * 1000), '1')
      }
      const memory = process.memoryUsage()
      options.gauge('runtime.memory.rss', memory.rss, 'byte')
      options.gauge('runtime.memory.heap', memory.heapUsed, 'byte')
      options.gauge('host.load.1m', host.load(), '1', { 'host.cpus': host.cpus() })
      options.gauge('host.memory.free', host.freeMemory(), 'byte')
      if (nextAt - swapAt >= SWAP_EVERY_MS) {
        swapAt = nextAt
        void host.swapUsed().then((bytes) => {
          if (bytes !== null && options.enabled()) options.gauge('host.swap.used', bytes, 'byte')
        })
      }
    }
    if (!observing) delay.enable()
    observing = true
    delay.reset()
    previous = next
    cpu = nextCpu
    at = nextAt
  }, INTERVAL_MS)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    delay.disable()
  }
}
