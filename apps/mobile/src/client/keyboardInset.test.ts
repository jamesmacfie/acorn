import { describe, expect, it } from 'vitest'
import { keyboardInset } from './keyboardInset'

describe('keyboardInset', () => {
  it('is the part of the page the visual viewport no longer covers', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0 })).toBe(336)
  })

  it('leaves out a page the browser has scrolled up to show the focused field', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 100 })).toBe(236)
  })

  it('is zero when nothing covers the page, or the browser resized the layout viewport itself', () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(508, { height: 508, offsetTop: 0 })).toBe(0)
  })
})
