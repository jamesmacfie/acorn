import { describe, expect, it } from 'vitest'
import { formatLastSeen, freshnessOf } from './freshness'

// docs/ui-design.md § States. Six values, and every input combination must land on exactly one: no
// infinite spinners, since anything past its deadline resolves to stale/offline/error.
describe('freshnessOf', () => {
  it('reads an online node with fresh data as live', () => {
    expect(freshnessOf('online')).toBe('live')
    expect(freshnessOf('online', { isStale: false })).toBe('live')
  })

  it('reports refreshing and stale on a reachable node', () => {
    expect(freshnessOf('online', { isFetching: true })).toBe('refreshing')
    expect(freshnessOf('online', { isStale: true })).toBe('stale')
  })

  it('treats degraded as stale, because there are no live events to trust', () => {
    // WS down, HTTP up: reads still work, so this is not offline, but nothing on screen is being
    // updated by events either.
    expect(freshnessOf('degraded')).toBe('stale')
    expect(freshnessOf('degraded', { isStale: false })).toBe('stale')
  })

  it('reads every unreachable state as offline, fetching or not', () => {
    // An in-flight fetch against an unreachable node is going to fail; calling it "refreshing" is the
    // infinite spinner docs/ui-design.md § States forbids.
    for (const state of ['offline', 'incompatible', 'revoked'] as const) {
      expect(freshnessOf(state)).toBe('offline')
      expect(freshnessOf(state, { isFetching: true })).toBe('offline')
      expect(freshnessOf(state, { isError: true })).toBe('offline')
    }
  })

  it('lets disabled win over everything', () => {
    expect(freshnessOf('online', { disabled: true, isFetching: true })).toBe('disabled')
    expect(freshnessOf('offline', { disabled: true })).toBe('disabled')
  })

  it('prefers error over refreshing on a reachable node', () => {
    expect(freshnessOf('online', { isError: true, isFetching: true })).toBe('error')
  })
})

describe('formatLastSeen', () => {
  const now = 1_700_000_000_000
  it('says never rather than fabricating an age', () => {
    expect(formatLastSeen(undefined, now)).toBe('never')
  })

  it('scales from seconds to days', () => {
    expect(formatLastSeen(now - 5_000, now)).toBe('just now')
    expect(formatLastSeen(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatLastSeen(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(formatLastSeen(now - 5 * 86_400_000, now)).toBe('5d ago')
  })

  it('never shows a negative age from a node clock ahead of ours', () => {
    expect(formatLastSeen(now + 60_000, now)).toBe('just now')
  })
})
