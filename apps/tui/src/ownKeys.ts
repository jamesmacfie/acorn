// A key as the keymap engine reads one, and the spelling table the two harnesses press through.
//
// Its own module rather than part of `./ownRenderer.ts`, and the reason is a byte count. The keymap
// host adapter needs `ownKeyEvent` and it is in `App`'s eager graph; `./ownRenderer.ts` reaches the
// whole new painter. Importing one from the other put 59 KB of a painter nobody had switched on into
// the startup closure of the build that does not use it, which the budget check caught
// (../scripts/check-startup-graph.mjs, docs/frontend.md § Startup budget).
//
// Nothing here knows about the parser. Wiring `./input/parser.ts`'s events into the dispatcher is
// phase 3's, along with the one translation it needs: `alt` becomes the keymap's `meta`.

/** A key as the keymap engine reads one: the fields its default matcher looks at, plus the two the
 *  dispatcher calls. Structurally OpenTUI's `KeyEvent`, which is all the engine ever wanted of it. */
export type OwnKeyEvent = {
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
 *  (./input/parser.ts § A key name is lower case). */
export function pressedKey(key: string, modifiers: {
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  super?: boolean
} = {}): OwnKeyEvent {
  const named = NAMED[key]
  if (named) return ownKeyEvent(named, modifiers)
  if (key === ' ') return ownKeyEvent('space', modifiers)
  const upper = key.length === 1 && key !== key.toLowerCase()
  return ownKeyEvent(key.toLowerCase(), upper ? { ...modifiers, shift: true } : modifiers)
}

export const ownKeyEvent = (name: string, modifiers: {
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  super?: boolean
} = {}): OwnKeyEvent => {
  const event: OwnKeyEvent = {
    name,
    ctrl: modifiers.ctrl ?? false,
    // `meta` is the keymap's spelling of Option and `option` is OpenTUI's, and the two vocabularies
    // disagree about exactly this one word (client-core kit/keys/keymap.ts). Both are set from the
    // same flag so a binding matches whichever the engine's matcher asks for.
    meta: modifiers.meta ?? false,
    option: modifiers.meta ?? false,
    shift: modifiers.shift ?? false,
    ...(modifiers.super === undefined ? {} : { super: modifiers.super }),
    sequence: name,
    raw: name,
    number: false,
    eventType: 'press',
    source: 'raw',
    defaultPrevented: false,
    preventDefault: () => { event.defaultPrevented = true },
    stopPropagation: () => {},
  }
  return event
}
