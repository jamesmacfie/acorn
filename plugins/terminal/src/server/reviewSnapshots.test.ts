import { describe, expect, it } from 'vitest'
import { REVIEW_SNAPSHOT_MAX_BYTES, TerminalReviewSnapshots } from './reviewSnapshots'

describe('terminal completion snapshots', () => {
  it('retains bounded output for a delayed read and rejects a different task', () => {
    let now = 1_000
    const snapshots = new TerminalReviewSnapshots(() => now)
    const event = { taskId: 'task', sessionId: 'session', exitCode: 0, completedAt: now }
    snapshots.capture(event, '€'.repeat(7_000))
    now += 30_000
    const input = snapshots.read('task', 'session')
    expect(input.availability).toBe('available')
    expect(Buffer.byteLength(input.output!, 'utf8')).toBeLessThanOrEqual(REVIEW_SNAPSHOT_MAX_BYTES)
    expect(input.output).not.toContain('�')
    expect(snapshots.read('other', 'session').availability).toBe('unavailable')
  })

  it('expires, evicts, and clears snapshots before a restarted engine can read them', () => {
    let now = 0
    const snapshots = new TerminalReviewSnapshots(() => now)
    for (let index = 0; index < 257; index++) {
      snapshots.capture({ taskId: 'task', sessionId: String(index), exitCode: 0, completedAt: now }, 'output')
    }
    expect(snapshots.read('task', '0').availability).toBe('unavailable')
    expect(snapshots.read('task', '256').availability).toBe('available')
    now = 60_000
    expect(snapshots.read('task', '256').availability).toBe('unavailable')
    snapshots.capture({ taskId: 'task', sessionId: 'new', exitCode: 0, completedAt: now }, 'output')
    snapshots.forget('new')
    expect(snapshots.read('task', 'new').availability).toBe('unavailable')
    snapshots.capture({ taskId: 'task', sessionId: 'new', exitCode: 0, completedAt: now }, 'output')
    snapshots.clear()
    expect(snapshots.read('task', 'new').availability).toBe('unavailable')
  })
})
