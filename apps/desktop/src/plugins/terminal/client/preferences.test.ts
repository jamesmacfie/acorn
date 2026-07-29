import { describe, expect, it } from 'vitest'
import { resolveTerminalFontSize } from './preferences'

describe('resolveTerminalFontSize', () => {
  it('accepts persisted integer sizes inside the supported range', () => {
    expect(resolveTerminalFontSize('11', 15)).toBe(11)
    expect(resolveTerminalFontSize('18', 15)).toBe(18)
    expect(resolveTerminalFontSize('24', 15)).toBe(24)
  })

  it('falls back for missing, fractional, or out-of-range values', () => {
    expect(resolveTerminalFontSize(undefined, 15)).toBe(15)
    expect(resolveTerminalFontSize('12.5', 15)).toBe(15)
    expect(resolveTerminalFontSize('10', 15)).toBe(15)
    expect(resolveTerminalFontSize('25', 15)).toBe(15)
    expect(resolveTerminalFontSize('large', 15)).toBe(15)
  })
})
