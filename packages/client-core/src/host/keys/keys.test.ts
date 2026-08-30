import { describe, expect, it } from 'vitest'
import { INTENTS, TYPING_EXEMPT } from '../../kit/keys/intents'
import { intentKeys, toKeymapKey } from '../../kit/keys/keymap'
import { _resetCollectionState, collectionState, setActiveItem, setSelectedItem } from '../../kit/keys/collectionState'

// The two halves a bug would hide in: the chord translation, because acorn's persisted chords and
// the keymap's disagree about two words, and the collection store, because keying it by anything but
// the item's own key is what loses your place on a refetch.

describe('acorn chords as keymap bindings', () => {
  it('renames the two modifiers the two vocabularies disagree about', () => {
    // The command key is `meta` to acorn and `super` to the keymap; Option is `alt` to acorn and
    // `meta` to the keymap. Getting this backwards binds Cmd+K to Option+K, silently.
    expect(toKeymapKey('meta+k')).toBe('super+k')
    expect(toKeymapKey('alt+k')).toBe('meta+k')
    expect(toKeymapKey('meta+ctrl+alt+shift+p')).toBe('super+ctrl+meta+shift+p')
  })

  it('renames Enter and leaves Escape alone', () => {
    expect(toKeymapKey('meta+shift+enter')).toBe('super+shift+return')
    expect(toKeymapKey('escape')).toBe('escape')
  })

  it('refuses a spelling acorn cannot produce', () => {
    expect(toKeymapKey('cmd+k')).toBeNull()
    expect(toKeymapKey('')).toBeNull()
  })
})

describe('the key map', () => {
  const macos = intentKeys('super')
  const other = intentKeys('ctrl')

  it('answers for every intent on both platforms', () => {
    for (const intent of INTENTS) {
      expect(macos[intent].length, intent).toBeGreaterThan(0)
      expect(other[intent].length, intent).toBeGreaterThan(0)
    }
  })

  it('puts the whole platform difference in the command key', () => {
    expect(macos.commit).toEqual(['super+return'])
    expect(other.commit).toEqual(['ctrl+return'])
    const unchanged = INTENTS.filter((intent) => intent !== 'commit' && intent !== 'search')
    for (const intent of unchanged) expect(macos[intent], intent).toEqual(other[intent])
  })

  it('keeps every typing-exempt intent off the bare keys', () => {
    for (const intent of TYPING_EXEMPT) {
      for (const key of macos[intent]) {
        // A typing-exempt intent reaches a focused composer, so a bare letter would eat the letter.
        expect(key === 'escape' || key.includes('+') || key.startsWith('f'), `${intent}: ${key}`).toBe(true)
      }
    }
  })
})

describe('collection state', () => {
  it('keeps a place and a selection under the item key, not its index', () => {
    _resetCollectionState()
    setActiveItem('list', 'pr-42')
    setSelectedItem('list', 'pr-7')
    // The rebuild a refetch causes changes every object and every index. The store is outside the
    // rows, so neither is a thing it can lose.
    expect(collectionState('list').active).toBe('pr-42')
    expect(collectionState('list').selected).toBe('pr-7')
  })

  it('reads as empty for a collection nobody has visited', () => {
    _resetCollectionState()
    expect(collectionState('never-opened')).toEqual({ active: null, selected: null, offset: 0 })
  })
})
