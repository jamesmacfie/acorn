import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'
import { createArmedConfirm } from './confirm'

// Carried over from the http plugin's confirmDelete.test.ts when that implementation became this
// hook, plus the auto-disarm timer docker's copy had and http's did not.
//
// createRoot because the hook registers an onCleanup for its timer; outside an owner Solid warns and
// the timer would outlive the test.
const withRoot = <T>(fn: () => T): T => createRoot((dispose) => {
  const result = fn()
  dispose()
  return result
})

describe('arm-to-confirm', () => {
  it('needs a second request on the same key', () => {
    withRoot(() => {
      const gate = createArmedConfirm()
      expect(gate.request('a')).toBe(false)
      expect(gate.armed()).toBe('a')
      expect(gate.request('a')).toBe(true)
      // Committing disarms, so a third click starts over rather than firing again.
      expect(gate.armed()).toBe(null)
      expect(gate.request('a')).toBe(false)
    })
  })

  it('arming another key cancels the first', () => {
    withRoot(() => {
      const gate = createArmedConfirm()
      gate.request('a')
      expect(gate.request('b')).toBe(false)
      expect(gate.armed()).toBe('b')
      expect(gate.request('a')).toBe(false)
    })
  })

  it('disarms on request', () => {
    withRoot(() => {
      const gate = createArmedConfirm()
      gate.request('a')
      gate.disarm()
      expect(gate.armed()).toBe(null)
      expect(gate.request('a')).toBe(false)
    })
  })

  it('disarms itself after the timeout, so a stale armed button cannot fire later', () => {
    vi.useFakeTimers()
    try {
      withRoot(() => {
        const gate = createArmedConfirm(() => 3000)
        gate.request('a')
        vi.advanceTimersByTime(2999)
        expect(gate.armed()).toBe('a')
        vi.advanceTimersByTime(1)
        expect(gate.armed()).toBe(null)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-arming restarts the timer rather than leaving the old one to fire', () => {
    vi.useFakeTimers()
    try {
      withRoot(() => {
        const gate = createArmedConfirm(() => 3000)
        gate.request('a')
        vi.advanceTimersByTime(2000)
        gate.request('b')
        vi.advanceTimersByTime(2000) // past 'a's original deadline
        expect(gate.armed()).toBe('b')
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
