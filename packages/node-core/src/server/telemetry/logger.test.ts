import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryLog, TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { ATTRS_MAX, ATTR_KEY_MAX, ATTR_VALUE_MAX, LOG_BODY_MAX } from '@acorn/protocol/telemetry.ts'
import { homedir } from 'node:os'
import { emitLog, onTelemetryBatch, flushTelemetry, resetTelemetryForTest, startTelemetry } from './collector'
import { createLogger, describeError } from './logger'
import { setTelemetryDataRoot } from './scrub'

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetTelemetryForTest()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setTelemetryDataRoot(null)
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
  it.each([false, true])('scrubs every level before stderr and collection, collecting=%s', async (enabled) => {
    const records = enabled ? await collecting() : () => []
    const token = 'sk-syntheticCredential12345'
    const dataRoot = '/tmp/acorn-synthetic-data'
    setTelemetryDataRoot(dataRoot)
    const text = `${token} ${homedir()}/private ${dataRoot}/private\u001b\nnext\tline`
    const log = createLogger(text, 'http')
    for (const level of ['debug', 'info', 'warn', 'error'] as const) log[level](text, { [text]: text, retry: false, count: 3, empty: null, owner: 'spoof', 'runtime\u0000': 'spoof' })
    const lines = [...warn.mock.calls, ...error.mock.calls].map(([line]) => String(line))
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      expect(line).not.toContain(token)
      expect(line).not.toContain(homedir())
      expect(line).not.toContain(dataRoot)
      expect([...line].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)).toBe(false)
      expect(line).toContain('<redacted>')
    }
    const logs = records().filter((record): record is TelemetryLog => record.kind === 'log')
    expect(logs).toHaveLength(enabled ? 4 : 0)
    for (const record of logs) {
      expect(JSON.stringify(record)).not.toContain(token)
      expect(record.attrs).toMatchObject({ owner: 'http', runtime: 'node', retry: false, count: 3, empty: null })
    }
  })

  it('caps fields, attribute count, and the complete UTF-8 stderr line', async () => {
    const records = await collecting()
    const attrs = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key${index}${'k'.repeat(100)}`, '🦉'.repeat(1_000)]))
    createLogger('t'.repeat(2_000)).info('🦉'.repeat(3_000), attrs)
    const line = String(error.mock.calls[0]?.[0])
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(4_000)
    expect(line).not.toContain('\ufffd')
    const record = records().find((value): value is TelemetryLog => value.kind === 'log')!
    expect(record.logger.length).toBeLessThanOrEqual(ATTR_VALUE_MAX)
    expect(record.body.length).toBeLessThanOrEqual(LOG_BODY_MAX)
    expect(Object.keys(record.attrs)).toHaveLength(ATTRS_MAX + 2)
    for (const [key, value] of Object.entries(record.attrs)) {
      expect(key.length).toBeLessThanOrEqual(ATTR_KEY_MAX)
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(ATTR_VALUE_MAX)
    }
    expect(records()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'metric', name: 'telemetry.truncated', value: expect.any(Number) })]))
  })

  it('scrubs keys and protects attribution on direct collector calls', async () => {
    const records = await collecting()
    const token = 'sk-syntheticCollectorKey12345'
    emitLog('http', { at: 0, level: 'info', logger: token, body: 'normal diagnostic', attrs: { [token]: 'safe', 'owner\u0000': 'spoof', 'runtime\u0000': 'spoof', count: 4 } })
    const record = records().find((value): value is TelemetryLog => value.kind === 'log')!
    expect(Object.keys(record.attrs)).toContain('<redacted>')
    expect(JSON.stringify(record)).not.toContain(token)
    expect(record.attrs).toMatchObject({ owner: 'http', runtime: 'node', count: 4 })
    expect(record.body).toBe('normal diagnostic')
  })

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
