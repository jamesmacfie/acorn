// Every key name this parser can produce, in one file.
//
// A name is a binding. `intentKeys` in `packages/client-core/src/kit/keys/keymap.ts` spells the ones
// both hosts share — `down`, `up`, `home`, `end`, `pagedown`, `pageup`, `right`, `left`, `return`,
// `space`, `escape`, `menu`, `delete`, `backspace`, `f6`, `f10` — and `../keys/install.ts` adds `tab`
// and `shift+tab` for this host. A key spelled `pgdn` here would be a binding that silently never
// fires, which is the worst thing this slice could do, so `./parser.test.ts` drives the check off
// those two tables rather than off a copy of them.
//
// The spellings are OpenTUI's, taken from its `keyName`, `tildeKeyMap` and kitty tables at 0.5.9,
// because the bindings were written against them and a rename would be a rewrite of the app's
// keyboard rather than of its parser (docs/tui.md § Keys and focus).

/** `CSI <number> ~`. Two numbers mean `home` and two mean `end`, which is not a mistake: the VT and
 *  the PC layouts disagreed and terminals still send both. */
export const TILDE_KEYS: Readonly<Record<number, string>> = {
  1: 'home',
  2: 'insert',
  3: 'delete',
  4: 'end',
  5: 'pageup',
  6: 'pagedown',
  7: 'home',
  8: 'end',
  11: 'f1',
  12: 'f2',
  13: 'f3',
  14: 'f4',
  15: 'f5',
  17: 'f6',
  18: 'f7',
  19: 'f8',
  20: 'f9',
  21: 'f10',
  23: 'f11',
  24: 'f12',
  29: 'menu',
}

/** `CSI <letter>` and `SS3 <letter>`, the cursor and editing keys.
 *
 *  `R` is missing on purpose and so is `M`. `CSI 1;2 R` is F3 with Shift in one reading and a cursor
 *  position report in another, and the ambiguity is thirty years old; we never ask for a position, so
 *  a parametric `R` is treated as a reply and dropped rather than pressed. `SS3 M` is the numeric
 *  keypad's Enter, which is `return` — see `SS3_ONLY`, since `CSI M` is the old mouse encoding. */
export const LETTER_KEYS: Readonly<Record<string, string>> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  E: 'clear',
  F: 'end',
  H: 'home',
  P: 'f1',
  Q: 'f2',
  S: 'f4',
  /** Backtab. Shift is in the sequence rather than in a parameter, so the parser adds it. */
  Z: 'tab',
}

/** What only `SS3` means, which is the keypad. `SS3 M` is its Enter key. */
export const SS3_ONLY: Readonly<Record<string, string>> = { M: 'return' }

/** The keypad's printable keys, which arrive as `SS3 <letter>` and type a character. The name is the
 *  character, so a `5` from the keypad and a `5` from the top row are one binding. */
export const SS3_TEXT: Readonly<Record<string, string>> = {
  p: '0',
  q: '1',
  r: '2',
  s: '3',
  t: '4',
  u: '5',
  v: '6',
  w: '7',
  x: '8',
  y: '9',
  j: '*',
  k: '+',
  l: ',',
  m: '-',
  n: '.',
  o: '/',
  X: '=',
}

/** The control characters that are keys in their own right rather than a letter with Ctrl held.
 *
 *  The order matters and it is the reason this is a table and not a range test: 8, 9, 10 and 13 are
 *  all inside the Ctrl+letter range, so Ctrl+H would eat Backspace, Ctrl+I would eat Tab and Ctrl+M
 *  would eat Return if the range were asked first. Nothing in the app binds those three chords and
 *  every reader presses those three keys. */
export const CONTROL_KEYS: Readonly<Record<number, string>> = {
  8: 'backspace',
  9: 'tab',
  10: 'linefeed',
  13: 'return',
  27: 'escape',
  127: 'backspace',
}

/** The kitty protocol's key codes, which are Unicode private-use codepoints for everything that is
 *  not a character (the protocol's "Functional key definitions" table).
 *
 *  The modifier keys at the end are here because event reporting sends a press and a release for
 *  them too, and a key with no name would otherwise decode as a private-use character and be typed
 *  into whatever field has the keys. */
export const KITTY_KEYS: Readonly<Record<number, string>> = {
  9: 'tab',
  13: 'return',
  27: 'escape',
  127: 'backspace',
  57344: 'escape',
  57345: 'return',
  57346: 'tab',
  57347: 'backspace',
  57348: 'insert',
  57349: 'delete',
  57350: 'left',
  57351: 'right',
  57352: 'up',
  57353: 'down',
  57354: 'pageup',
  57355: 'pagedown',
  57356: 'home',
  57357: 'end',
  57358: 'capslock',
  57359: 'scrolllock',
  57360: 'numlock',
  57361: 'printscreen',
  57362: 'pause',
  57363: 'menu',
  57364: 'f1',
  57365: 'f2',
  57366: 'f3',
  57367: 'f4',
  57368: 'f5',
  57369: 'f6',
  57370: 'f7',
  57371: 'f8',
  57372: 'f9',
  57373: 'f10',
  57374: 'f11',
  57375: 'f12',
  57376: 'f13',
  57377: 'f14',
  57378: 'f15',
  57379: 'f16',
  57380: 'f17',
  57381: 'f18',
  57382: 'f19',
  57383: 'f20',
  57399: 'kp0',
  57400: 'kp1',
  57401: 'kp2',
  57402: 'kp3',
  57403: 'kp4',
  57404: 'kp5',
  57405: 'kp6',
  57406: 'kp7',
  57407: 'kp8',
  57408: 'kp9',
  57409: 'kpdecimal',
  57410: 'kpdivide',
  57411: 'kpmultiply',
  57412: 'kpminus',
  57413: 'kpplus',
  57414: 'return',
  57415: 'kpequal',
  57416: 'kpseparator',
  57417: 'left',
  57418: 'right',
  57419: 'up',
  57420: 'down',
  57421: 'pageup',
  57422: 'pagedown',
  57423: 'home',
  57424: 'end',
  57425: 'insert',
  57426: 'delete',
  57427: 'clear',
  57441: 'leftshift',
  57442: 'leftctrl',
  57443: 'leftalt',
  57444: 'leftsuper',
  57445: 'lefthyper',
  57446: 'leftmeta',
  57447: 'rightshift',
  57448: 'rightctrl',
  57449: 'rightalt',
  57450: 'rightsuper',
  57451: 'righthyper',
  57452: 'rightmeta',
}

/** The keypad keys that type a character, by the name above. The keypad's arrows and editing keys are
 *  named for the key they duplicate, so they need nothing here. */
export const KITTY_TEXT: Readonly<Record<string, string>> = {
  kp0: '0',
  kp1: '1',
  kp2: '2',
  kp3: '3',
  kp4: '4',
  kp5: '5',
  kp6: '6',
  kp7: '7',
  kp8: '8',
  kp9: '9',
  kpdecimal: '.',
  kpdivide: '/',
  kpmultiply: '*',
  kpminus: '-',
  kpplus: '+',
  kpequal: '=',
  kpseparator: ',',
}
