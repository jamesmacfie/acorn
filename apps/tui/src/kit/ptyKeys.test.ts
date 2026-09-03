import { describe, expect, it } from 'vitest'
import { BARE_KEYS, intentKeys } from '@acorn/client-core/kit/keys/keymap.ts'
import { encodeKeyText, encodePaste, LEGACY_MODES, type PtyKey, type PtyModes } from './ptyKeys'

// The key encoder against a recorded table, because there is nothing else to check it with.
//
// The bytes below are not derived from anything in this repo: they are what xterm, kitty, Ghostty,
// Terminal.app and the Linux console all send, and the whole promise of the encoder is that a program
// running inside a rectangle cannot tell it from a terminal. So the table is written out rather than
// generated, one row per key with its escape sequence spelled as the reader would find it in
// `infocmp` or in xterm's own `ctlseqs` — a table generated from the code under test would agree with
// any mistake in it.
//
// Escapes are `\x1b` and never ``, so a run of them lines up in a column
// (../input/parser.test.ts uses the same spelling for the same reason).

const APPLICATION: PtyModes = { applicationCursor: true, bracketedPaste: false }
const BRACKETED: PtyModes = { applicationCursor: false, bracketedPaste: true }

const key = (name: string, modifiers: Partial<PtyKey> = {}): PtyKey => ({
  name,
  ctrl: false,
  meta: false,
  shift: false,
  ...modifiers,
})

/** A key that types a character carries it, exactly as the parser and the harness both do
 *  (../ownKeys.ts § pressedKey, ../input/events.ts § KeyEvent). */
const types = (character: string, modifiers: Partial<PtyKey> = {}): PtyKey =>
  key(character.toLowerCase(), { sequence: character, ...modifiers })

/** The recorded table: what a terminal sends, in the mode where nothing has been asked for. */
const LEGACY: readonly (readonly [string, PtyKey, string])[] = [
  // The cursor keys, which are the whole reason `applicationCursor` exists.
  ['up', key('up'), '\x1b[A'],
  ['down', key('down'), '\x1b[B'],
  ['right', key('right'), '\x1b[C'],
  ['left', key('left'), '\x1b[D'],
  ['home', key('home'), '\x1b[H'],
  ['end', key('end'), '\x1b[F'],

  // A modifier is the xterm parameter, which is the bitmask plus one: shift 1, alt 2, ctrl 4.
  ['shift+up', key('up', { shift: true }), '\x1b[1;2A'],
  ['alt+up', key('up', { meta: true }), '\x1b[1;3A'],
  ['ctrl+up', key('up', { ctrl: true }), '\x1b[1;5A'],
  ['ctrl+shift+left', key('left', { ctrl: true, shift: true }), '\x1b[1;6D'],
  // `nextPane` and `prevPane`, spelled `ctrl+meta` in the intent table because the keymap calls
  // Option `meta`. The parameter is the pair added together: 4 and 2 and one.
  ['ctrl+meta+right', key('right', { ctrl: true, meta: true }), '\x1b[1;7C'],
  ['ctrl+meta+left', key('left', { ctrl: true, meta: true }), '\x1b[1;7D'],
  ['ctrl+home', key('home', { ctrl: true }), '\x1b[1;5H'],
  ['ctrl+end', key('end', { ctrl: true }), '\x1b[1;5F'],

  // The editing and paging keys, which are `CSI <number> ~` and take the same parameter.
  ['insert', key('insert'), '\x1b[2~'],
  ['delete', key('delete'), '\x1b[3~'],
  ['pageup', key('pageup'), '\x1b[5~'],
  ['pagedown', key('pagedown'), '\x1b[6~'],
  ['ctrl+delete', key('delete', { ctrl: true }), '\x1b[3;5~'],
  ['shift+pagedown', key('pagedown', { shift: true }), '\x1b[6;2~'],
  ['menu', key('menu'), '\x1b[29~'],

  // The function keys, whose first four predate the tilde form and never took it.
  ['f1', key('f1'), '\x1bOP'],
  ['f2', key('f2'), '\x1bOQ'],
  ['f3', key('f3'), '\x1bOR'],
  ['f4', key('f4'), '\x1bOS'],
  ['f5', key('f5'), '\x1b[15~'],
  ['f6', key('f6'), '\x1b[17~'],
  ['f7', key('f7'), '\x1b[18~'],
  ['f8', key('f8'), '\x1b[19~'],
  ['f9', key('f9'), '\x1b[20~'],
  ['f10', key('f10'), '\x1b[21~'],
  ['f11', key('f11'), '\x1b[23~'],
  ['f12', key('f12'), '\x1b[24~'],
  // The two chords the intent table spells with a function key.
  ['shift+f6', key('f6', { shift: true }), '\x1b[17;2~'],
  ['shift+f10', key('f10', { shift: true }), '\x1b[21;2~'],
  ['ctrl+f2', key('f2', { ctrl: true }), '\x1b[1;5Q'],

  // The keys that are one byte.
  ['return', key('return'), '\r'],
  ['linefeed', key('linefeed'), '\n'],
  ['escape', key('escape'), '\x1b'],
  ['tab', key('tab'), '\t'],
  ['backspace', key('backspace'), '\x7f'],
  ['space', key('space', { sequence: ' ' }), ' '],
  // Backtab is its own sequence rather than Tab with a parameter, which is the one place a modifier
  // does not become one.
  ['shift+tab', key('tab', { shift: true }), '\x1b[Z'],
  // `commit` is Ctrl+Return, and a legacy terminal has never had a second byte for it — which is the
  // whole reason this app asks the kitty protocol to disambiguate its *own* keyboard.
  ['ctrl+return', key('return', { ctrl: true }), '\r'],
  ['alt+return', key('return', { meta: true }), '\x1b\r'],
  ['ctrl+backspace', key('backspace', { ctrl: true }), '\b'],
  ['alt+backspace', key('backspace', { meta: true }), '\x1b\x7f'],
  ['ctrl+space', key('space', { ctrl: true, sequence: ' ' }), '\x00'],

  // Characters, and the two things that can be held down over one.
  ['a', types('a'), 'a'],
  ['A', types('A', { shift: true }), 'A'],
  ['j', types('j'), 'j'],
  ['/', types('/'), '/'],
  ['é', types('é'), 'é'],
  ['ctrl+a', types('a', { ctrl: true }), '\x01'],
  ['ctrl+c', types('c', { ctrl: true }), '\x03'],
  ['ctrl+d', types('d', { ctrl: true }), '\x04'],
  ['ctrl+z', types('z', { ctrl: true }), '\x1a'],
  // `search` is Ctrl+F on this host, and inside a rectangle it is the program's like everything else.
  ['ctrl+f', types('f', { ctrl: true }), '\x06'],
  ['ctrl+[', types('[', { ctrl: true }), '\x1b'],
  ['ctrl+\\', types('\\', { ctrl: true }), '\x1c'],
  ['ctrl+?', types('?', { ctrl: true }), '\x7f'],
  ['alt+b', types('b', { meta: true }), '\x1bb'],
  ['alt+f', types('f', { meta: true }), '\x1bf'],
  // Alt and Ctrl together, which is emacs's `M-C-b` and is the prefix in front of the control byte.
  ['ctrl+alt+b', types('b', { ctrl: true, meta: true }), '\x1b\x02'],
  // …and the same three as the parser actually delivers them, which is with no text on them at all:
  // a chord types nothing, so the character Ctrl or Alt was held over is the key's name and nothing
  // else (../input/parser.ts § character).
  ['ctrl+c as the parser sends it', key('c', { ctrl: true }), '\x03'],
  ['alt+b as the parser sends it', key('b', { meta: true }), '\x1bb'],
  ['ctrl+alt+b as the parser sends it', key('b', { ctrl: true, meta: true }), '\x1b\x02'],
]

/** The same keys in application cursor mode, which is what every full-screen program sets. Only the
 *  six unmodified cursor keys move; everything else is listed above and is the same either way. */
const APPLICATION_CURSOR: readonly (readonly [string, PtyKey, string])[] = [
  ['up', key('up'), '\x1bOA'],
  ['down', key('down'), '\x1bOB'],
  ['right', key('right'), '\x1bOC'],
  ['left', key('left'), '\x1bOD'],
  ['home', key('home'), '\x1bOH'],
  ['end', key('end'), '\x1bOF'],
  // A modified one goes back to CSI, because there is nowhere in `SS3 A` to put a parameter.
  ['ctrl+up', key('up', { ctrl: true }), '\x1b[1;5A'],
  ['shift+left', key('left', { shift: true }), '\x1b[1;2D'],
]

describe('the pty key encoder', () => {
  it.each(LEGACY.map(([name, event, bytes]) => [name, event, bytes] as const))(
    'sends %s as the bytes a terminal sends',
    (_name, event, bytes) => {
      expect(encodeKeyText(event, LEGACY_MODES)).toBe(bytes)
    },
  )

  it.each(APPLICATION_CURSOR.map(([name, event, bytes]) => [name, event, bytes] as const))(
    'sends %s as the bytes a terminal sends in application cursor mode',
    (_name, event, bytes) => {
      expect(encodeKeyText(event, APPLICATION)).toBe(bytes)
    },
  )

  it('covers every key this host binds', () => {
    // The anti-vacuity check, and the one that keeps the table honest as the app's keyboard changes:
    // a key some binding names but this file has no row for is a key that would reach a shell as
    // nothing at all. Read off the two shared tables rather than a copy of them, which is what
    // `../input/parser.test.ts` does for the same reason (client-core kit/keys/keymap.ts).
    const recorded = new Set(LEGACY.map(([name]) => name))
    const named = new Set<string>()
    for (const keys of Object.values(intentKeys('ctrl'))) for (const spelling of keys) named.add(spelling)
    for (const bare of BARE_KEYS) named.add(bare)
    // The two this host adds for itself (../keys/install.ts § HOST_KEYS).
    named.add('tab')
    named.add('shift+tab')
    // `g` and `shift+g` are a letter and a capital, which the table records as `a` and `A`: the case
    // is in the modifier and the character is what the key types, so one row stands for every letter.
    const letters = /^(shift\+)?[a-z]$/
    expect([...named].filter((spelling) => !recorded.has(spelling) && !letters.test(spelling)).sort())
      .toEqual([])
    expect(recorded.size).toBeGreaterThan(50)
  })

  it('sends nothing for a key that types nothing and names nothing', () => {
    // The kitty protocol's event reporting delivers a press and a release for Caps Lock and for the
    // modifier keys themselves, and a private-use codepoint written into somebody's shell would be
    // worse than silence (../input/names.ts § KITTY_KEYS).
    expect(encodeKeyText(key('capslock'), LEGACY_MODES)).toBe('')
    expect(encodeKeyText(key('leftshift', { shift: true }), LEGACY_MODES)).toBe('')
    expect(encodeKeyText(key('f19'), LEGACY_MODES)).toBe('')
  })

  it('brackets a paste only where the program asked for it', () => {
    // Unbracketed, a hundred pasted lines are a hundred commands; bracketed, the program is told
    // where the paste begins and ends and can treat all of it as text.
    const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
    expect(decode(encodePaste('one\ntwo', LEGACY_MODES))).toBe('one\ntwo')
    expect(decode(encodePaste('one\ntwo', BRACKETED))).toBe('\x1b[200~one\ntwo\x1b[201~')
  })
})
