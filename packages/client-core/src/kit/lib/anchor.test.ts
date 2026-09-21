import { describe, expect, it } from 'vitest'
import { anchoredPosition } from './anchor'

const viewport = { width: 800, height: 600 }

describe('anchored surface placement', () => {
  it('flips a bottom menu above a trigger near the viewport foot', () => {
    expect(anchoredPosition(
      { top: 560, bottom: 584, left: 620, right: 720, width: 100, height: 24 },
      { width: 160, height: 180 },
      viewport,
      'bottom-end',
      true,
    )).toEqual({ top: 376, left: 560 })
  })

  it('keeps a bottom menu below when that side has room', () => {
    expect(anchoredPosition(
      { top: 100, bottom: 124, left: 20, right: 120, width: 100, height: 24 },
      { width: 160, height: 180 },
      viewport,
      'bottom-start',
      true,
    )).toEqual({ top: 128, left: 20 })
  })

  it('clamps a point menu without inventing an opposite trigger edge', () => {
    expect(anchoredPosition(
      { top: 590, bottom: 590, left: 790, right: 790, width: 0, height: 0 },
      { width: 160, height: 180 },
      viewport,
      'bottom-start',
      false,
    )).toEqual({ top: 416, left: 636 })
  })

  it('flips a right-hand popover to the left when that side has more room', () => {
    expect(anchoredPosition(
      { top: 100, bottom: 124, left: 760, right: 784, width: 24, height: 24 },
      { width: 240, height: 120 },
      viewport,
      'right-start',
      true,
    )).toEqual({ top: 100, left: 516 })
  })
})
