// The bytes a keystroke sends the program inside a `pty` rectangle.
//
// headless xterm parses bytes and draws cells and has no keyboard at all, which is the one thing it
// lacks for this job: the browser build gets this from its own `Keyboard.ts` and the DOM events
// behind it, and there is no DOM here. So the encoder is ours, and what it covers is what a terminal
// program can *receive* rather than everything a browser can send — no composition, no dead keys, no
// `KeyboardEvent.code`, because our own parser has already turned bytes into a name and a character
// (../input/events.ts § KeyEvent).
//
// **The mode table.** A terminal's keyboard is not one encoding, it is a small set of modes the
// program inside turns on and off, and the emulator is the only thing that knows which are on. So
// every mode this honours is read off `Terminal.modes` at the moment a key arrives rather than
// remembered here:
//
//   DECCKM, application cursor keys   `CSI ? 1 h`. The arrows and Home and End go `ESC O A` instead
//                                     of `ESC [ A`. Every full-screen program sets it — vim, less,
//                                     htop — and a program that asked for it and got the CSI form
//                                     reads an arrow as an unbound escape sequence.
//   bracketed paste                   `CSI ? 2004 h`. A paste arrives wrapped in `ESC [ 200 ~` and
//                                     `ESC [ 201 ~`, which is what lets an editor tell a hundred
//                                     pasted lines from a hundred Returns.
//   DECNKM, application keypad        `CSI ? 66 h`. Deliberately not honoured. Our parser names a
//                                     keypad key after the key it duplicates (`kp4` is `left`,
//                                     `kpenter` is `return`), so by the time a key reaches here
//                                     there is nothing left to tell apart — and no first-party
//                                     surface in this app is driven from a numeric keypad.
//   modifyOtherKeys and kitty         Neither exists to honour. `IModes` in @xterm/headless 5.5.0
//                                     reports ten modes and neither of those is among them, so a
//                                     chord is encoded the legacy way: the C0 byte for Ctrl, an
//                                     `ESC` prefix for Alt, and the xterm modifier parameter on the
//                                     keys that take parameters. A program that asked for either
//                                     protocol gets the encoding every terminal falls back to,
//                                     which is the encoding it has to handle anyway.
//
// **A modifier is a parameter on the keys that have one and a prefix on the keys that do not.**
// `ESC [ 1 ; 5 A` is Ctrl+Up and every terminal since xterm 216 sends it; there is no such spelling
// for Ctrl+J, which is the byte 0x0A and always has been. That asymmetry is the whole reason this
// file is a set of tables rather than one function.

const CSI = '\x1b['
const SS3 = '\x1bO'
const ESC = '\x1b'

/** What a key is to this encoder: a name, the four modifiers, and the character it types.
 *
 *  Structurally the dispatcher's own event, so the rectangle hands one straight over. `meta` is
 *  Option/Alt under the keymap's spelling and `super` is the platform command key, which a terminal
 *  emulator keeps for itself and never delivers (../input/events.ts § Modifiers). */
export type PtyKey = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  super?: boolean
  /** What the key types, and empty for a key that types nothing — which includes every chord, because
   *  our parser stops calling a key a character the moment Ctrl or Alt is on it. So a chord's
   *  character is its `name`, and § encodeKeyText reads both (../input/parser.ts § character). */
  sequence?: string
}

/** The modes the encoding depends on, as the emulator reports them. A plain object rather than the
 *  `Terminal` itself, so the encoder can be driven from a table in a test. */
export type PtyModes = {
  /** DECCKM. */
  applicationCursor: boolean
  /** `CSI ? 2004 h`. */
  bracketedPaste: boolean
}

export const LEGACY_MODES: PtyModes = { applicationCursor: false, bracketedPaste: false }

/** The cursor keys and the two edit keys that have both a CSI and an SS3 spelling. Home and End are
 *  in here rather than in the tilde table because that is the pair xterm sends: `CSI H` and `CSI F`
 *  unmodified, `SS3 H` and `SS3 F` in application mode. */
const CURSOR: Readonly<Record<string, string>> = {
  up: 'A',
  down: 'B',
  right: 'C',
  left: 'D',
  home: 'H',
  end: 'F',
}

/** `CSI <parameter> ~`, and the parameter is the number in the sequence rather than an index of
 *  ours. The gaps are real: there is no 16 and no 22, because DEC's own table skipped them. */
const TILDE: Readonly<Record<string, string>> = {
  insert: '2',
  delete: '3',
  pageup: '5',
  pagedown: '6',
  f5: '15',
  f6: '17',
  f7: '18',
  f8: '19',
  f9: '20',
  f10: '21',
  f11: '23',
  f12: '24',
  menu: '29',
}

/** The four function keys that predate the tilde form and still arrive as `SS3 <letter>`. */
const FUNCTION: Readonly<Record<string, string>> = { f1: 'P', f2: 'Q', f3: 'R', f4: 'S' }

/** The keys that are one byte, and that byte. Backspace is DEL rather than BS, which is what every
 *  terminal has sent since the VT220 and what readline and every shell expect. */
const SINGLE: Readonly<Record<string, string>> = {
  return: '\r',
  linefeed: '\n',
  tab: '\t',
  escape: ESC,
  backspace: '\x7f',
  space: ' ',
}

/** The punctuation that has a control byte of its own, beyond the letters. `?` is the odd one: Ctrl+?
 *  is DEL rather than 0x1f, which is why it cannot come out of the arithmetic below. */
const CONTROL_PUNCTUATION: Readonly<Record<string, string>> = {
  '@': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  _: '\x1f',
  '?': '\x7f',
}

/**
 * The xterm modifier parameter, which is a bitmask plus one, and nought where nothing is held.
 *
 * The same four bits our parser reads a modifier parameter with, in the same order, because they are
 * the same convention: shift 1, alt 2, ctrl 4, super 8 (../input/parser.ts § modifiersOf). Nought
 * rather than 1 is the caller's signal that the unmodified spelling is the one to send, which is a
 * different sequence and not the same sequence with a parameter of 1 on it.
 */
function modifierMask(key: PtyKey): number {
  let mask = 0
  if (key.shift) mask += 1
  if (key.meta) mask += 2
  if (key.ctrl) mask += 4
  if (key.super) mask += 8
  return mask
}

/** The control byte a Ctrl+character sends, or nothing where the pair has none. Letters are the
 *  character with its top three bits cleared, which is what makes Ctrl+A 0x01 and Ctrl+Z 0x1a. */
function controlByte(character: string): string | undefined {
  const lower = character.toLowerCase()
  if (lower >= 'a' && lower <= 'z') return String.fromCharCode(lower.charCodeAt(0) - 0x60)
  return CONTROL_PUNCTUATION[lower]
}

/**
 * One keystroke as the bytes a terminal sends, or the empty string for a key that sends none.
 *
 * A key that types nothing and names nothing in the tables sends nothing, which is the honest answer
 * for Caps Lock and for the modifier keys themselves: the kitty protocol's event reporting delivers
 * a press and a release for each of those, and a private-use codepoint written into somebody's shell
 * would be worse than silence (../input/names.ts § KITTY_KEYS).
 */
export function encodeKeyText(key: PtyKey, modes: PtyModes): string {
  const mask = modifierMask(key)

  // Shift+Tab is backtab, which is its own sequence rather than Tab with a parameter. Asked first,
  // because Tab is also in the single-byte table below.
  if (key.name === 'tab' && key.shift && !key.ctrl && !key.meta) return `${CSI}Z`

  const cursor = CURSOR[key.name]
  if (cursor !== undefined) {
    // A modified cursor key is always the CSI form, application mode or not: there is no place to
    // put a parameter in `SS3 A`, and xterm switches to CSI for exactly that reason.
    if (mask) return `${CSI}1;${mask + 1}${cursor}`
    return `${modes.applicationCursor ? SS3 : CSI}${cursor}`
  }

  const tilde = TILDE[key.name]
  if (tilde !== undefined) return mask ? `${CSI}${tilde};${mask + 1}~` : `${CSI}${tilde}~`

  const named = FUNCTION[key.name]
  if (named !== undefined) return mask ? `${CSI}1;${mask + 1}${named}` : `${SS3}${named}`

  const single = SINGLE[key.name]
  if (single !== undefined) {
    // Ctrl on one of these is the byte below it rather than a parameter: Ctrl+Backspace is BS, and
    // Ctrl+Space is NUL, which is how a reader sets a mark in emacs. Ctrl+Return is `\r` — a legacy
    // terminal has never had another byte for it, which is the whole reason this app asks for the
    // kitty protocol on its *own* keyboard (docs/tui.md § The adapter).
    const byte = key.ctrl && key.name === 'backspace' ? '\b'
      : key.ctrl && key.name === 'space' ? '\x00'
        : single
    // Alt is an ESC prefix, which is what "meta sends escape" means and what every terminal in this
    // decade does by default.
    return key.meta ? `${ESC}${byte}` : byte
  }

  // Whatever the key types, and the key's own name where a chord types nothing.
  //
  // Both halves are load-bearing. A capital arrives as text rather than as a name, because the
  // dispatcher moved a letter's case into the modifier and left the character here. And a chord types
  // nothing at all — our parser leaves `text` empty for Ctrl+A and for Alt+B, deliberately, since a
  // terminal that sent `ESC` first has already decided the key is not a character — so the character
  // Ctrl was held over is the *name*, and reading only the text would send a shell nothing at all
  // (../input/parser.ts § character, ../ownKeys.ts § pressedKey).
  const said = key.sequence ?? ''
  const typed = said !== '' ? said : ([...key.name].length === 1 ? key.name : '')
  if (typed === '') return ''
  if (key.ctrl) {
    const byte = controlByte(typed)
    if (byte === undefined) return key.meta ? `${ESC}${typed}` : typed
    return key.meta ? `${ESC}${byte}` : byte
  }
  return key.meta ? `${ESC}${typed}` : typed
}

const encoder = new TextEncoder()

/** The same, as the bytes a PTY takes. UTF-8, because a character above the ASCII range is one
 *  keystroke and several bytes and the channel this goes down is a byte stream. */
export function encodeKey(key: PtyKey, modes: PtyModes): Uint8Array {
  return encoder.encode(encodeKeyText(key, modes))
}

/**
 * A paste as the bytes the program inside receives, bracketed where it asked to be.
 *
 * Unbracketed it is the text and nothing else, which is what a program that never set the mode
 * expects and is also why pasting a hundred lines into a shell that did not ask runs a hundred
 * commands. Bracketed, the program is told where the paste begins and ends and can treat the whole
 * of it as text — the difference between filling in a commit message and sending it.
 */
export function encodePaste(text: string, modes: PtyModes): Uint8Array {
  if (!modes.bracketedPaste) return encoder.encode(text)
  return encoder.encode(`${CSI}200~${text}${CSI}201~`)
}
