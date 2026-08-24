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
})
