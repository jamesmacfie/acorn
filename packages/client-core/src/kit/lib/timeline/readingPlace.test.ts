import { describe, expect, it } from 'vitest'
import { atLive, LIVE, placeAfterScroll, resolveAnchor, samePlace, type ReadingPlace } from './readingPlace'

const turn = (key: string, index: number, offset = 0): ReadingPlace => ({ at: 'turn', key, index, offset })
const tall = { scrollTop: 40, scrollHeight: 4000, clientHeight: 100 }
const foot = { scrollTop: 3900, scrollHeight: 4000, clientHeight: 100 }

describe('placeAfterScroll', () => {
  // The five rules the follow decision has always had, now answered with a place instead of a flag.
  it('goes live when a gesture lands at the foot', () => {
    expect(placeAfterScroll({ place: turn('a', 0), gesture: true, geometry: foot, anchor: () => null })).toEqual(LIVE)
  })

  it('takes the turn under the reader when a gesture lands away from the foot', () => {
    const anchor = turn('c', 2, 12)
    expect(placeAfterScroll({ place: LIVE, gesture: true, geometry: tall, anchor: () => anchor })).toEqual(anchor)
  })

  it('keeps following when a shrinking list clamps the scroll away from the foot', () => {
    expect(placeAfterScroll({ place: LIVE, gesture: false, geometry: tall, anchor: () => turn('c', 2) })).toEqual(LIVE)
  })

  it('leaves a reader who scrolled up alone when layout moves the scroll', () => {
    const place = turn('c', 2, 12)
    expect(placeAfterScroll({ place, gesture: false, geometry: tall, anchor: () => turn('z', 9) })).toEqual(place)
  })

  it('does not resume following when a shrinking list clamps a reader against the new foot', () => {
    // A filter drops rows or the tools collapse, the list is suddenly short, and the clamp lands the
    // reader against the new foot. No gesture caused it, so the reader stays where they were reading.
    const place = turn('c', 2, 12)
    expect(placeAfterScroll({ place, gesture: false, geometry: foot, anchor: () => null })).toEqual(place)
  })

  it('keeps the place when a gesture finds no turn to anchor to', () => {
    const place = turn('c', 2, 12)
    expect(placeAfterScroll({ place, gesture: true, geometry: tall, anchor: () => null })).toEqual(place)
  })
})

describe('atLive', () => {
  it('counts the last screenful of slack as the foot', () => {
    expect(atLive({ scrollTop: 3910, scrollHeight: 4000, clientHeight: 100 })).toBe(true)
    expect(atLive({ scrollTop: 3700, scrollHeight: 4000, clientHeight: 100 })).toBe(false)
  })
})

describe('samePlace', () => {
  it('ignores a difference too small to see', () => {
    expect(samePlace(turn('a', 0, 10), turn('a', 0, 10.4))).toBe(true)
    expect(samePlace(turn('a', 0, 10), turn('a', 0, 24))).toBe(false)
    expect(samePlace(turn('a', 0), LIVE)).toBe(false)
    expect(samePlace(LIVE, LIVE)).toBe(true)
  })
})

describe('resolveAnchor', () => {
  it('uses the turn itself when it is still there', () => {
    expect(resolveAnchor({ at: 'turn', key: 'c', index: 2, offset: 12 }, ['a', 'b', 'c', 'd']))
      .toEqual({ key: 'c', offset: 12 })
  })

  it('takes whatever holds that position when the turn has gone', () => {
    // A permission card resolving takes its row out of the middle of the list. One row out is a place.
    expect(resolveAnchor({ at: 'turn', key: 'c', index: 2, offset: 12 }, ['a', 'b', 'd', 'e']))
      .toEqual({ key: 'd', offset: 0 })
  })

  it('gives up when the list is too short to hold that position', () => {
    // Not a near miss: a different list. The caller sends the reader to the live end, which is where a
    // first visit goes, and never to the top.
    expect(resolveAnchor({ at: 'turn', key: 'c', index: 9, offset: 12 }, ['a', 'b'])).toBeNull()
  })
})
