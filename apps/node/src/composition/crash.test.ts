import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryError, TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { flushTelemetry, onTelemetryBatch, resetTelemetryForTest, startTelemetry } from '@acorn/node-core/server/telemetry/collector.ts'
import { installCrashHandlers, resetCrashHandlersForTest } from './crash'

// The handlers are process-wide, and installing one changes what Node does with an uncaught throw,
// so every test here takes them back afterwards and none of them lets the real `process.exit` run.
const settle = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetCrashHandlersForTest()
  resetTelemetryForTest()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  resetCrashHandlersForTest()
  resetTelemetryForTest()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const collecting = async (): Promise<() => TelemetryRecord[]> => {
  startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
  const records: TelemetryRecord[] = []
  onTelemetryBatch((batch) => records.push(...batch.records))
  await settle()
  return () => {
    flushTelemetry()
    return records
  }
}

describe('installCrashHandlers', () => {
  it('records a fatal error with its stack, prints it, and exits 1', async () => {
    vi.useFakeTimers()
    const records = await collecting()
    const exit = vi.fn()
    installCrashHandlers({ exit })
    process.emit('uncaughtException', new TypeError('cannot read properties of undefined'))
    await settle()

    const fatal = records().find((record) => record.kind === 'error') as TelemetryError
    expect(fatal).toMatchObject({ name: 'TypeError', level: 'fatal', handled: false })
    // The one place in the node that sends a stack. A fatal error without one is not worth sending.
    expect(fatal.stack).toContain('TypeError')
    expect(fatal.attrs.seam).toBe('uncaughtException')
    // Node prints the stack itself when no listener is registered, so a listener that did not print
    // would make a crash quieter than it was before this file existed.
    expect(String(error.mock.calls)).toContain('cannot read properties of undefined')
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('treats an unhandled rejection the same way, whatever was thrown', async () => {
    vi.useFakeTimers()
    const records = await collecting()
    const exit = vi.fn()
    installCrashHandlers({ exit })
    process.emit('unhandledRejection', 'a bare string', Promise.resolve())
    await settle()
    const fatal = records().find((record) => record.kind === 'error') as TelemetryError
    expect(fatal).toMatchObject({ level: 'fatal', handled: false, message: 'a bare string' })
    expect(fatal.attrs.seam).toBe('unhandledRejection')
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits on the deadline when the flush never finishes', async () => {
    vi.useFakeTimers()
    const exit = vi.fn()
    // A sink that never answers is the case this deadline exists for: a crash must not become a
    // hang because somebody's exporter is waiting on a socket.
    installCrashHandlers({ exit, flush: () => new Promise<void>(() => {}), deadlineMs: 1_000 })
    process.emit('uncaughtException', new Error('boom'))
    await settle()
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits once, however the flush ends', async () => {
    const exit = vi.fn()
    installCrashHandlers({ exit, flush: () => Promise.reject(new Error('the sink is broken')), deadlineMs: 50 })
    process.emit('uncaughtException', new Error('boom'))
    await settle()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('installs once, however many times it is called', () => {
    const exit = vi.fn()
    installCrashHandlers({ exit })
    installCrashHandlers({ exit })
    expect(process.listenerCount('uncaughtException')).toBe(1)
  })
})
