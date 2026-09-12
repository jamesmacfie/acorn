import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryLog, TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { onTelemetryBatch, flushTelemetry, resetTelemetryForTest, startTelemetry } from './collector'
import { createLogger, describeError } from './logger'

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetTelemetryForTest()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  resetTelemetryForTest()
  vi.restoreAllMocks()
})

const settle = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

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

describe('createLogger', () => {
  it('writes the tag the hand-written prefix used to write', () => {
    createLogger('schedules').warn('github:refresh timed out')
    expect(warn).toHaveBeenCalledWith('[schedules] github:refresh timed out')
  })

  it('sends warn to console.warn and everything else to console.error', () => {
    const log = createLogger('server')
    log.debug('a')
    log.info('b')
    log.warn('c')
    log.error('d')
    expect(warn.mock.calls).toEqual([['[server] c']])
    // `info` and `debug` on stderr as well, because stdout is a wire in the standalone entry.
    expect(error.mock.calls).toEqual([['[server] a'], ['[server] b'], ['[server] d']])
  })

  it('puts attributes on the line as key=value, not as an inspected object', () => {
    createLogger('server').error('unhandled error', { name: 'TypeError', requestId: 'abc', retry: false })
    expect(error).toHaveBeenCalledWith('[server] unhandled error name=TypeError requestId=abc retry=false')
  })

  it('emits a record only while telemetry is collecting', async () => {
    createLogger('server').info('before anyone subscribed')
    const records = await collecting()
    expect(records()).toEqual([])
    createLogger('rollbar', 'rollbar').info('refresh scheduled', { every: 300 })
    const log = records().find((record) => record.kind === 'log') as TelemetryLog
    expect(log).toMatchObject({ level: 'info', logger: 'rollbar', body: 'refresh scheduled' })
    // The owner is the host's, which is the whole reason `ctx.log` came back.
    expect(log.attrs).toMatchObject({ owner: 'rollbar', every: 300 })
  })
})

describe('describeError', () => {
  it('gives a name and a scrubbed one-line message, and no stack', () => {
    const error = new TypeError('Authorization: Bearer abcdefghijklmnop')
    expect(describeError(error)).toEqual({ name: 'TypeError', message: 'Authorization: <redacted>' })
    expect(describeError(error)).not.toHaveProperty('stack')
  })

  it('handles a thrown non-error', () => {
    expect(describeError('just a string')).toEqual({ name: 'Error', message: 'just a string' })
    expect(describeError(undefined)).toEqual({ name: 'Error', message: 'unknown error' })
  })
})
