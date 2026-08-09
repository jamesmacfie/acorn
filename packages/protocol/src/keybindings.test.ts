import { describe, expect, it } from 'vitest'
import {
  eventChord,
  isPluginKeyClaim,
  isPluginShortcutChord,
  isReservedPluginKeyClaim,
  isTypingTarget,
  parseChord,
} from './keybindings'

describe('chord grammar', () => {
  it.each(['meta+shift+f', 'ctrl+alt+enter', 'meta+,', 'meta+['])('accepts canonical chord %s', (chord) => {
    expect(parseChord(chord)).not.toBeNull()
  })

  it.each(['Meta+Shift+F', 'shift+meta+f', 'meta+meta+f', 'hyper+f', 'meta+f g', 'meta++'])('rejects chord %s', (chord) => {
    expect(parseChord(chord)).toBeNull()
  })

  it('refuses bare plugin bindings and reserved frame claims', () => {
    expect(isPluginShortcutChord('a')).toBe(false)
    expect(isPluginShortcutChord('shift+a')).toBe(false)
    expect(isPluginShortcutChord('meta+a')).toBe(true)
    for (const chord of ['meta+k', 'meta+,', 'meta+1', 'meta+9', 'escape']) {
      expect(isReservedPluginKeyClaim(chord)).toBe(true)
      expect(isPluginKeyClaim(chord)).toBe(false)
    }
  })
})

describe('event normalization', () => {
  it('uses physical letter and digit keys and fixed modifier order', () => {
    expect(eventChord({ code: 'KeyF', key: 'F', metaKey: true, ctrlKey: false, altKey: true, shiftKey: true }))
      .toBe('meta+alt+shift+f')
    expect(eventChord({ code: 'Digit2', key: '@', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }))
      .toBe('meta+shift+2')
  })
})

describe('typing targets', () => {
  it('recognizes form, contenteditable, and EditContext targets without DOM constructors', () => {
    expect(isTypingTarget({ nodeName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true)
    expect(isTypingTarget({ isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ editContext: {} })).toBe(true)
    expect(isTypingTarget({ nodeName: 'DIV' })).toBe(false)
  })
})
