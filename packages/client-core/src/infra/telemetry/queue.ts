import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'

// What a runtime that is not the node holds between flushes (docs/telemetry.md § The renderer).
//
// The node's collector keeps 5,000 records because it is the collector and a burst there is the
// whole fleet's. A client keeps 1,000, which is a couple of minutes of an interactive session, and
// it is a queue rather than a buffer for one reason: the node it posts to can be offline, and the
// records worth keeping across that are the recent ones.

/** Enough to ride out a node restart, small enough that a renderer nobody is collecting from cannot
 *  grow a tab's heap out of its own instrumentation. */
export const TELEMETRY_QUEUE_MAX = 1_000

export type TelemetryQueue = {
  push(record: TelemetryRecord): void
  /** Everything held, in order, and the queue is empty afterwards. */
  take(): TelemetryRecord[]
  /** Put a failed post's records back at the front, oldest first, so order survives a retry. */
  putBack(records: readonly TelemetryRecord[]): void
  size(): number
  /** How many records the cap has thrown away since the last time this was read, and it resets on
   *  read. The next flush turns it into a `telemetry.dropped` count, the same as the node's. */
  takeDropped(): number
}

export function telemetryQueue(max: number = TELEMETRY_QUEUE_MAX): TelemetryQueue {
  let held: TelemetryRecord[] = []
  let dropped = 0
  const trim = (): void => {
    if (held.length <= max) return
    dropped += held.length - max
    // Oldest first. A queue that dropped its newest records would keep reporting the moment a
    // session went wrong and lose everything after it.
    held = held.slice(held.length - max)
  }
  return {
    push(record) {
      held.push(record)
      trim()
    },
    take() {
      const out = held
      held = []
      return out
    },
    putBack(records) {
      held = [...records, ...held]
      trim()
    },
    size: () => held.length,
    takeDropped() {
      const count = dropped
      dropped = 0
      return count
    },
  }
}
