// The per-host key map: which keys mean which intent, and how acorn's persisted chords are spelled
// for `@opentui/keymap`.
//
// Two vocabularies meet here and they disagree about two words, which is the whole reason this file
// exists rather than the strings being passed straight through. acorn's chords say `meta` for the
// platform command key and `alt` for Option; the keymap says `super` for the command key and `meta`
// for Option (its HTML adapter maps `event.metaKey` to `super` and `event.altKey` to `meta`). It
// also names Return `return`, where acorn's chords say `enter`. A chord translated in one place is a
// setting that keeps working; a chord translated at each call site is four bugs.

import type { Intent } from './intents'

const MODIFIER_SPELLING: Record<string, string> = {
  meta: 'super',
  ctrl: 'ctrl',
  alt: 'meta',
  shift: 'shift',
}

const KEY_SPELLING: Record<string, string> = {
  enter: 'return',
  escape: 'escape',
}

/**
 * An acorn chord (`meta+shift+enter`) as a keymap binding (`super+shift+return`), or `null` when it
 * is not a chord acorn can produce.
 *
 * Deliberately tolerant of the parts rather than re-parsing: `parseChord` in
 * `@acorn/protocol/keybindings.ts` is the authority on what a valid chord is, and this runs after it.
 */
export function toKeymapKey(chord: string): string | null {
  const parts = chord.split('+')
  const key = parts.pop()
  if (!key) return null
  const modifiers = parts.map((part) => MODIFIER_SPELLING[part])
  if (modifiers.some((modifier) => !modifier)) return null
  return [...modifiers, KEY_SPELLING[key] ?? key].join('+')
}

/**
 * The desktop key map, as keymap binding strings per intent.
 *
 * `primary` is the platform's command key, which the keymap host reports: `super` on macOS and
 * `ctrl` everywhere else. It is the one place a platform difference lives, which is the point of
 * having intents at all.
 */
export function intentKeys(primary: 'super' | 'ctrl'): Record<Intent, readonly string[]> {
  return {
    // `j` and `k` are here rather than in a vim mode: they are bare letters, so they only ever fire
    // outside a typing target, and every collection in the app gets them at once.
    next: ['down', 'j'],
    prev: ['up', 'k'],
    first: ['home', 'g'],
    last: ['end', 'shift+g'],
    pageNext: ['pagedown'],
    pagePrev: ['pageup'],
    expand: ['right', 'l'],
    collapse: ['left', 'h'],
    activate: ['return', 'space'],
    dismiss: ['escape'],
    commit: [`${primary}+return`],
    search: [`${primary}+f`, '/'],
    // The keyboard's own context-menu key, plus the chord Windows and GNOME both fire it with.
    menu: ['menu', 'shift+f10'],
    delete: ['delete', 'backspace'],
    // F6 is the platform convention for "the next region of this window" on Windows and in every
    // browser, and it is not a chord anything else claims. Panes are a left-to-right row, so they
    // take the horizontal arrows, with `ctrl+meta` (Ctrl+Option) because Ctrl+Shift+Arrow is
    // word-selection in a text field on two of the three platforms and these reach one.
    nextRegion: ['f6'],
    prevRegion: ['shift+f6'],
    nextPane: ['ctrl+meta+right'],
    prevPane: ['ctrl+meta+left'],
  }
}

/** Bare-key intent bindings must not fire while something is being typed into. */
export const BARE_KEYS: ReadonlySet<string> = new Set([
  'j', 'k', 'h', 'l', 'g', 'shift+g', '/', 'space', 'return',
  'down', 'up', 'left', 'right', 'home', 'end', 'pagedown', 'pageup', 'delete', 'backspace',
])
