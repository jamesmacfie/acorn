import { describe, expect, it } from 'vitest'
import { formatChord } from './formatChord'

describe('formatChord', () => {
  it('writes the registry and the keymap spellings the same way', () => {
    expect(formatChord('meta+shift+n')).toBe('⇧⌘N')
    expect(formatChord('shift+super+n')).toBe('⇧⌘N')
  })

  it('orders modifiers ⌃⌥⇧⌘ whatever order they arrive in', () => {
    expect(formatChord('meta+alt+ctrl+shift+k')).toBe('⌃⌥⇧⌘K')
  })

  it('names the keys that have a symbol, and keeps punctuation', () => {
    expect(formatChord('meta+enter')).toBe('⌘↩')
    expect(formatChord('shift+enter')).toBe('⇧↩')
    expect(formatChord('escape')).toBe('Esc')
    expect(formatChord('super+/')).toBe('⌘/')
    expect(formatChord('shift+?')).toBe('⇧?')
    expect(formatChord('meta++')).toBe('⌘+')
  })

  it('formats each step of a sequence', () => {
    expect(formatChord('ctrl+k ctrl+s')).toBe('⌃K ⌃S')
  })
})
