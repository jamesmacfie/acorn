import { describe, expect, it } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { telemetryQueue, TELEMETRY_QUEUE_MAX } from './queue'

const event = (name: string): TelemetryRecord => ({ kind: 'event', at: 1, name, attrs: {} })
const names = (records: readonly TelemetryRecord[]): string[] =>
  records.map((record) => (record.kind === 'event' ? record.name : record.kind))

describe('the client telemetry queue', () => {
  it('hands back what it holds, in order, and empties itself', () => {
    const queue = telemetryQueue()
    queue.push(event('a'))
    queue.push(event('b'))
    expect(names(queue.take())).toEqual(['a', 'b'])
    expect(queue.size()).toBe(0)
  })

  it('drops the oldest at the cap and counts what it dropped', () => {
    const queue = telemetryQueue(3)
    for (const name of ['a', 'b', 'c', 'd', 'e']) queue.push(event(name))
    // The newest three. A queue that dropped its newest would keep the moment a session went wrong
    // and lose everything after it.
    expect(names(queue.take())).toEqual(['c', 'd', 'e'])
    expect(queue.takeDropped()).toBe(2)
    // Read once. The next flush turns it into one `telemetry.dropped` count and it starts again.
    expect(queue.takeDropped()).toBe(0)
  })

  it('puts a failed post back at the front, so order survives a retry', () => {
    const queue = telemetryQueue()
    queue.push(event('a'))
    const taken = queue.take()
    queue.push(event('b'))
    queue.putBack(taken)
    expect(names(queue.take())).toEqual(['a', 'b'])
  })

  it('holds a thousand records by default, which is the offline window', () => {
    const queue = telemetryQueue()
    for (let index = 0; index < TELEMETRY_QUEUE_MAX + 10; index += 1) queue.push(event(String(index)))
    expect(queue.size()).toBe(TELEMETRY_QUEUE_MAX)
  })
})
