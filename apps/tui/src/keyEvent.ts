import type { KeyEvent as ParsedKey } from './input/events'

// A key as the keymap engine reads one, and the spelling table the two harnesses press through.
//
// Its own module rather than part of `./renderer.ts`, and the reason is a byte count. The keymap host
// adapter needs `keyEvent` and it is in `App`'s eager graph, while `./renderer.ts` reaches the whole
// painter — the screen, the buffers and the parser. Importing one from the other put 59 KB into a
// startup closure that had no use for it, which the budget check caught
// (../scripts/check-startup-graph.mjs, docs/frontend.md § Startup budget).
//
// The parser's own vocabulary meets the engine's here, and the whole of the difference is one word:
// what our parser calls `alt` the keymap calls `meta` (§ keyPressed). Everything else is the same
// key under two names for the same thing.

/** A key as the keymap engine reads one: the fields its default matcher looks at, plus the two the
 *  dispatcher calls and the two flags those set.
 *
 *  Structurally OpenTUI's `KeyEvent`, and both flags have to be here rather than in the closures that
 *  set them. `defaultPrevented` is what `./keys/install.ts § typeInto` reads to leave a claimed key
 *  alone; `propagationStopped` is what the engine reads to know an intercept consumed the key, and
 *  without it `ctx.consume()` was a no-op — an entered `pty` rectangle sent every key to its program
 *  and then let the app's own bindings answer the same key, so Escape's pair left and F6 walked out
 *  of the rectangle it had just taken (@opentui/keymap § handleKeyEvent). */
export type KeyEvent = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  super?: boolean
  sequence: string
  raw: string
  number: boolean
  eventType: 'press' | 'repeat' | 'release'
  source: 'raw'
  defaultPrevented: boolean
  propagationStopped: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

/** The harness's spelling of a key, as the name our parser produces for it.
 *
 *  Both suites press through one table today: a single character is itself, and a named key is
 *  OpenTUI's upper-case spelling of the bytes that make it, because that is what its `mockInput`
 *  takes (`KeyCodes.RETURN`). Our parser names the same keys the way `./input/names.ts` does, so the
 *  two spellings have to meet somewhere and this is the shorter half. Phase 4 rewrites the harness to
 *  press a `KeyEvent` and this table goes with it (./kit/render.tsx § RAW_KEYS). */
const NAMED: Readonly<Record<string, string>> = {
  RETURN: 'return',
  LINEFEED: 'linefeed',
  TAB: 'tab',
  BACKSPACE: 'backspace',
  DELETE: 'delete',
  HOME: 'home',
  END: 'end',
  ESCAPE: 'escape',
  ARROW_UP: 'up',
  ARROW_DOWN: 'down',
  ARROW_RIGHT: 'right',
  ARROW_LEFT: 'left',
  PAGEUP: 'pageup',
  PAGEDOWN: 'pagedown',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, at) => [`F${at + 1}`, `f${at + 1}`])),
}

/** One key as the engine will read it, from whichever spelling the caller had.
 *
 *  A letter's case moves into the modifier rather than into the name, because `intentKeys` binds
 *  `last` as `shift+g` and a parser reporting `G` would produce a chord string no binding matches
 *  (./input/parser.ts § A key name is lower case). The character itself goes in `sequence`, which is
 *  what a field types: with the case in the modifier there is nowhere else for a capital to live, and
 *  `space` as a name is a word rather than a character (./kit/field.ts § typedBy). */
export function pressedKey(key: string, modifiers: {
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  super?: boolean
} = {}): KeyEvent {
  const named = NAMED[key]
  // A named key types nothing at all, which is the same thing our parser says by leaving `text`
  // empty: what a Return does inside a field is the edit model's decision from the name, not a
  // character the terminal handed over (./input/events.ts § KeyEvent).
  if (named) return keyEvent(named, modifiers, '')
  if (key === ' ') return keyEvent('space', modifiers, ' ')
  const upper = key.length === 1 && key !== key.toLowerCase()
  return keyEvent(key.toLowerCase(), upper ? { ...modifiers, shift: true } : modifiers, key)
}

export const keyEvent = (name: string, modifiers: {
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  super?: boolean
} = {}, typed?: string): KeyEvent => {
  const event: KeyEvent = {
    name,
    ctrl: modifiers.ctrl ?? false,
    // `meta` is the keymap's spelling of Option and `option` is OpenTUI's, and the two vocabularies
    // disagree about exactly this one word (client-core kit/keys/keymap.ts). Both are set from the
    // same flag so a binding matches whichever the engine's matcher asks for.
    meta: modifiers.meta ?? false,
    option: modifiers.meta ?? false,
    shift: modifiers.shift ?? false,
    ...(modifiers.super === undefined ? {} : { super: modifiers.super }),
    sequence: typed ?? name,
    raw: typed ?? name,
    number: false,
    eventType: 'press',
    source: 'raw',
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault: () => { event.defaultPrevented = true },
    stopPropagation: () => { event.propagationStopped = true },
  }
  return event
}

/**
 * A key from the input parser, as the engine reads one.
 *
 * The one translation the two vocabularies need. Our parser reports the modifier the terminal
 * reports, which is `alt`; `@opentui/keymap` matches on `meta` and OpenTUI's own event carries both
 * `meta` and `option` for it, so all three are the same flag here and a binding matches whichever
 * name the engine's matcher asks for (./input/events.ts § Modifiers).
 *
 * `text` becomes `sequence`, which is what a field types and what the pty encoder sends: a key that
 * types nothing carries an empty string, and the model decides from the name what a Return does
 * (./kit/field.ts § typedBy, ./kit/ptyKeys.ts).
 */
export function keyPressed(key: ParsedKey): KeyEvent {
  const event = keyEvent(key.name, {
    ctrl: key.ctrl,
    meta: key.alt,
    shift: key.shift,
    super: key.super,
  }, key.text)
  event.eventType = key.action
  return event
}
