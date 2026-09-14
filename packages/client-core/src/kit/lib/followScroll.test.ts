import { describe, expect, it } from 'vitest'
import { nextFollowing } from './followScroll'

describe('nextFollowing', () => {
  it('follows again once a scroll lands near the bottom', () => {
    expect(nextFollowing({ following: false, nearBottom: true, userDriven: true })).toBe(true)
  })

  it('stops following when the reader scrolls away from the bottom', () => {
    expect(nextFollowing({ following: true, nearBottom: false, userDriven: true })).toBe(false)
  })

  it('keeps following when a shrinking list clamps the scroll away from the bottom', () => {
    expect(nextFollowing({ following: true, nearBottom: false, userDriven: false })).toBe(true)
  })

  it('leaves a reader who scrolled up alone when layout moves the scroll', () => {
    expect(nextFollowing({ following: false, nearBottom: false, userDriven: false })).toBe(false)
  })

  it('does not resume following when a shrinking list clamps a reader near the new bottom', () => {
    // A filter drops rows or the tools collapse, the list is suddenly short, and the clamp lands the
    // reader near the new bottom. No gesture caused it, so the reader stays where they were reading.
    expect(nextFollowing({ following: false, nearBottom: true, userDriven: false })).toBe(false)
  })
})
