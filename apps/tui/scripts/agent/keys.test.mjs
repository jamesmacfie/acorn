import { describe, expect, it } from 'vitest'
import { keyBytes } from './keys.mjs'

describe('agent terminal key encoding', () => {
  it('sends ordinary navigation through legacy terminal bytes', () => {
    expect(keyBytes('down', 'legacy')).toBe('\x1b[B')
    expect(keyBytes('shift+tab', 'legacy')).toBe('\x1b[Z')
    expect(keyBytes('ctrl+c', 'legacy')).toBe('\x03')
  })

  it('uses kitty disambiguation for chords the legacy terminal cannot send', () => {
    expect(keyBytes('down', 'kitty')).toBe('\x1b[57353u')
    expect(keyBytes('ctrl+return', 'kitty')).toBe('\x1b[13;5u')
    expect(() => keyBytes('ctrl+return', 'legacy')).toThrow('cannot distinguish')
  })

  it('rejects unknown keys rather than injecting arbitrary bytes', () => {
    expect(() => keyBytes('ctrl+banana')).toThrow('Unknown key')
  })
})
