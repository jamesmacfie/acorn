import type { TerminalCompletedEvent, TerminalReviewInput } from '../contract/reviewInput'

export const REVIEW_SNAPSHOT_MAX_BYTES = 16 * 1024
export const REVIEW_SNAPSHOT_MAX_COUNT = 256
export const REVIEW_SNAPSHOT_TTL_MS = 60_000

export function trailingUtf8(value: string, maxBytes = REVIEW_SNAPSHOT_MAX_BYTES): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let start = bytes.length - maxBytes
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1
  return bytes.subarray(start).toString('utf8')
}

export function leadingUtf8(value: string, maxBytes = REVIEW_SNAPSHOT_MAX_BYTES): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

export class TerminalReviewSnapshots {
  private readonly entries = new Map<string, { event: TerminalCompletedEvent; output: string; expiresAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  capture(event: TerminalCompletedEvent, output: string): void {
    this.prune()
    this.entries.delete(event.sessionId)
    this.entries.set(event.sessionId, { event, output: trailingUtf8(output), expiresAt: this.now() + REVIEW_SNAPSHOT_TTL_MS })
    while (this.entries.size > REVIEW_SNAPSHOT_MAX_COUNT) this.entries.delete(this.entries.keys().next().value!)
  }

  read(taskId: string, sessionId: string): TerminalReviewInput {
    this.prune()
    const entry = this.entries.get(sessionId)
    if (!entry || entry.event.taskId !== taskId) {
      return {
        taskId, sessionId, exitCode: null, completedAt: 0,
        availability: 'unavailable', output: null,
        unavailableReason: 'Retained terminal output is unavailable or expired.',
      }
    }
    return {
      ...entry.event,
      availability: entry.output.trim() ? 'available' : 'unavailable',
      output: entry.output.trim() ? entry.output : null,
      unavailableReason: entry.output.trim() ? null : 'The terminal had no retained output.',
    }
  }

  clear(): void { this.entries.clear() }

  forget(sessionId: string): void { this.entries.delete(sessionId) }

  private prune(): void {
    const now = this.now()
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id)
  }
}
