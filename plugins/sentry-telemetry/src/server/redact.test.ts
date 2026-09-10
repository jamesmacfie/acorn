import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { describe, expect, it } from 'vitest'
import { redactBatch, redactRecord } from './redact'

const both = { taskIds: true, stacks: true }

describe('redactRecord', () => {
  it('scrubs a credential out of a span name, which core takes on trust as a pattern', () => {
    // Core scrubs attribute values and log bodies at the ingest door. A name is supposed to be
    // `http.request`, so nothing before this point checks one, and this is the last place to look.
    const span: TelemetryRecord = {
      kind: 'span',
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 'fetch ghp_abcdefghijklmnopqrstuvwxyz01',
      start: 0,
      durationMs: 1,
      status: 'ok',
      attrs: {},
    }
    expect((redactRecord(span, both) as { name: string }).name).toBe('fetch <redacted>')
  })

  it('scrubs an attribute value again on the way out', () => {
    const event: TelemetryRecord = { kind: 'event', at: 0, name: 'auth', attrs: { header: 'Bearer sk-abcdefghijkl' } }
    expect(redactRecord(event, both).attrs.header).toBe('Bearer <redacted>')
  })

  it('drops task ids when the owner turned them off', () => {
    const event: TelemetryRecord = { kind: 'event', at: 0, name: 'notice.delivered', attrs: { 'task.id': 'task-7', kind: 'agent' } }
    expect(redactRecord(event, { taskIds: false, stacks: true }).attrs).toEqual({ kind: 'agent' })
    expect(redactRecord(event, both).attrs).toEqual({ 'task.id': 'task-7', kind: 'agent' })
  })

  it('removes the stack key entirely when stacks are off', () => {
    const failure: TelemetryRecord = {
      kind: 'error', at: 0, name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at x (/a/b.ts:1:1)',
      level: 'error', handled: true, attrs: {},
    }
    expect(redactRecord(failure, { taskIds: true, stacks: false })).not.toHaveProperty('stack')
    expect(redactRecord(failure, both)).toHaveProperty('stack')
  })

  it('caps a name rather than letting a whole file through as one', () => {
    const metric: TelemetryRecord = { kind: 'metric', at: 0, name: 'x'.repeat(400), type: 'count', value: 1, attrs: {} }
    expect((redactRecord(metric, both) as { name: string }).name).toHaveLength(128)
  })

  it('leaves an ordinary record alone', () => {
    const log: TelemetryRecord = { kind: 'log', at: 3, level: 'info', logger: 'schedules', body: 'ran', attrs: { owner: 'core' } }
    expect(redactRecord(log, both)).toEqual(log)
  })
})

describe('redactBatch', () => {
  it('keeps the batch fields and cleans every record', () => {
    const batch = {
      node: 'node-1',
      version: '0.1.0',
      records: [{ kind: 'event', at: 0, name: 'a', attrs: { 'task.id': 't' } }] as TelemetryRecord[],
    }
    expect(redactBatch(batch, { taskIds: false, stacks: true })).toEqual({
      node: 'node-1',
      version: '0.1.0',
      records: [{ kind: 'event', at: 0, name: 'a', attrs: {} }],
    })
  })
})
