import { clusters } from '../width'
import { fromVisual, toVisual, type Row } from '../wrap'

// What a field holds and what one key does to it: a string, an offset, and a table.
//
// This is the model `./asking.tsx`'s `Input` and `Textarea` own under our painter, in place of
// OpenTUI's `EditBuffer`. It is a plain string rather than a rope and it is not `@codemirror/state`:
// spike 4 wrote it both ways against the same 40 assertions and the library saved 26 lines for 47,922
// bytes in the eager graph, of a package phase 4 is trying to delete
// (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 4). A keystroke on a 400-line
// note costs 99 microseconds either way.
//
// **Selection and undo are deliberately absent.** Shift with an arrow really does select under
// OpenTUI today, and nothing under `apps/tui/src` reads a selection, sets one, or asks for undo:
// `CopyButton` is the copy path and there is no way to get a selection out again. A selection you can
// make and cannot use is not worth the anchor it costs every operation here.
//
// **One table for both fields, which the phase file expected to be two.** OpenTUI's `Input` is its
// `Textarea` with `height: 1` and one binding changed — Return submits instead of inserting a newline
// — so the whole of the difference is the `newline` flag below. Two tables would have been the same
// twenty lines written twice, and they would have drifted the first time somebody added a chord.
//
// **Home and End go to the visual line's ends, not the document's**, which is a deliberate departure
// from `defaultTextareaKeyBindings`, where they are `buffer-home` and `buffer-end` and the line
// boundaries are on Ctrl+A and Ctrl+E. Both spellings reach the visual line here, because that is
// what a reader in a wrapped composer means by the key and no golden frame records a cursor press
// (docs/tui.md § The five key groups).

/** A field's whole state.
 *
 *  `assoc` says which side of a soft break the caret is on and `goal` is the column Up and Down are
 *  trying to keep. Both are the model's rather than the component's because both are consumed by the
 *  next keystroke rather than by the frame (../wrap.ts). */
export type Field = {
  text: string
  cursor: number
  assoc: number
  goal: number | undefined
}

/** A key as this table reads one: OpenTUI's `KeyEvent` and our parser's cut down to what a field
 *  looks at. `sequence` is what the key types; a key that types nothing carries a control character
 *  or an empty string, and the name is what decides what it does instead. */
export type Press = {
  name: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  super?: boolean
  sequence?: string
}

const clamp = (value: number, limit: number): number => Math.min(Math.max(value, 0), limit)

export const create = (text: string, cursor = text.length): Field =>
  ({ text, cursor: clamp(cursor, text.length), assoc: 0, goal: undefined })

/** A value written in from outside, keeping the caret where it was.
 *
 *  A caret that was at the end stays at the end, which is what a field being typed into from a
 *  controlled prop needs: the component writes the value back on every keystroke, and a caret pinned
 *  to an offset would fall behind by one character per key (./asking.tsx § Input). */
export const setValue = (field: Field, text: string): Field =>
  create(text, field.cursor >= field.text.length ? text.length : field.cursor)

/** Replace a range and put the caret after what was inserted. Every edit goes through here, so there
 *  is one place the two cursor facts are reset: a document that changed has no goal column to keep
 *  and no soft break to be on the far side of. */
const change = (field: Field, from: number, to: number, insert: string): Field => ({
  text: field.text.slice(0, from) + insert + field.text.slice(to),
  cursor: from + insert.length,
  assoc: 0,
  goal: undefined,
})

const move = (field: Field, cursor: number, assoc = 0, goal?: number): Field =>
  ({ text: field.text, cursor: clamp(cursor, field.text.length), assoc, goal })

/** Where the logical line the caret is on starts and ends. Not the visual row: `Ctrl+K` and `Ctrl+U`
 *  delete to the ends of the line the text has, which is what they do in a shell. */
const lineFrom = (text: string, pos: number): number => text.lastIndexOf('\n', pos - 1) + 1
const lineTo = (text: string, pos: number): number => {
  const at = text.indexOf('\n', pos)
  return at < 0 ? text.length : at
}

/** One grapheme cluster left or right, stepping over a line break at either end.
 *
 *  By cluster rather than by code unit, because the two differ on every astral character and every
 *  combining mark, and a caret between a base and its accent is a caret a terminal cannot draw
 *  (../width.ts § clusters). */
export function byChar(text: string, pos: number, forward: boolean): number {
  const from = lineFrom(text, pos)
  const to = lineTo(text, pos)
  if (forward) {
    if (pos >= text.length) return pos
    if (pos >= to) return to + 1
    for (const cell of clusters(text.slice(from, to))) if (from + cell.from > pos) return from + cell.from
    return to
  }
  if (pos <= 0) return pos
  if (pos <= from) return from - 1
  let last = from
  for (const cell of clusters(text.slice(from, to))) {
    if (from + cell.from >= pos) break
    last = from + cell.from
  }
  return last
}

/** Word, space, or everything else: the three categories a word motion stops between. The idea is
 *  `@codemirror/state § charCategorizer`'s; the classes are the ones a reader means by a word. */
const WORD = /[\p{L}\p{N}_]/u
const categoryOf = (char: string): number => (/\s/.test(char) ? 0 : WORD.test(char) ? 1 : 2)

/** Past the leading space and then to the far edge of one run of one category, which is where a word
 *  motion stops. */
export function byGroup(text: string, pos: number, forward: boolean): number {
  let group: number | null = null
  let at = pos
  for (;;) {
    const step = byChar(text, at, forward)
    if (step === at) return at
    const kind = categoryOf(text.slice(Math.min(step, at), Math.max(step, at)))
    if (group === null) {
      if (kind !== 0) group = kind
    } else if (kind !== group) return at
    at = step
  }
}

/** The visual row the caret is on, which is what Home, End, Up and Down are all about. */
const rowAt = (field: Field, rows: readonly Row[]): { row: number; col: number } =>
  toVisual(field.text, rows, field.cursor, field.assoc)

/** One row up or down at the goal column, or nothing at all where there is no such row.
 *
 *  `false` rather than clamping to the ends of the document, and that is what makes a single-line
 *  `Input` inert on Up and Down without a second table: there is one row, so there is nothing to move
 *  to, and a handler that changed nothing says so (docs/tui.md § The five key groups). */
function byRow(field: Field, rows: readonly Row[], down: boolean): Field | false {
  const here = rowAt(field, rows)
  const goal = field.goal ?? here.col
  const row = here.row + (down ? 1 : -1)
  if (row < 0 || row >= rows.length) return false
  return move(field, fromVisual(field.text, rows, row, goal), 1, goal)
}

/** What one key does, given the rows the caller wrapped. */
type Action = (field: Field, rows: readonly Row[]) => Field | false

const left: Action = (field) => move(field, byChar(field.text, field.cursor, false), -1)
const right: Action = (field) => move(field, byChar(field.text, field.cursor, true), 1)
const wordLeft: Action = (field) => move(field, byGroup(field.text, field.cursor, false), -1)
const wordRight: Action = (field) => move(field, byGroup(field.text, field.cursor, true), 1)
const home: Action = (field, rows) => move(field, rows[rowAt(field, rows).row]!.from, 1)
const end: Action = (field, rows) => move(field, rows[rowAt(field, rows).row]!.to, -1)
const backspace: Action = (field) => change(field, byChar(field.text, field.cursor, false), field.cursor, '')
const forward: Action = (field) => change(field, field.cursor, byChar(field.text, field.cursor, true), '')
const killWordBack: Action = (field) => change(field, byGroup(field.text, field.cursor, false), field.cursor, '')
const killWordForward: Action = (field) => change(field, field.cursor, byGroup(field.text, field.cursor, true), '')
const killToEnd: Action = (field) => change(field, field.cursor, lineTo(field.text, field.cursor), '')
const killToStart: Action = (field) => change(field, lineFrom(field.text, field.cursor), field.cursor, '')
const killLine: Action = (field) =>
  change(field, lineFrom(field.text, field.cursor), lineTo(field.text, field.cursor), '')

/**
 * Every chord a field answers, keyed the way `chordOf` below spells one.
 *
 * The set is `defaultTextareaKeyBindings` (`@opentui/core` 0.5.9) minus selection and undo, plus the
 * Home and End departure the header names. It is written out rather than derived because a reader
 * comparing the two tables should be able to do it by eye, and because these are the keys a reader
 * already has and would notice losing.
 */
const KEYS: Readonly<Record<string, Action>> = {
  left,
  right,
  'ctrl+b': left,
  'ctrl+f': right,
  home,
  end,
  'ctrl+a': home,
  'ctrl+e': end,
  'meta+a': home,
  'meta+e': end,
  up: (field, rows) => byRow(field, rows, false),
  down: (field, rows) => byRow(field, rows, true),
  'ctrl+left': wordLeft,
  'ctrl+right': wordRight,
  'meta+left': wordLeft,
  'meta+right': wordRight,
  'meta+b': wordLeft,
  'meta+f': wordRight,
  backspace,
  'shift+backspace': backspace,
  delete: forward,
  'shift+delete': forward,
  'ctrl+d': forward,
  'ctrl+w': killWordBack,
  'ctrl+backspace': killWordBack,
  'meta+backspace': killWordBack,
  'meta+d': killWordForward,
  'ctrl+delete': killWordForward,
  'meta+delete': killWordForward,
  'ctrl+k': killToEnd,
  'ctrl+u': killToStart,
  'ctrl+shift+d': killLine,
}

/** A key as the table above spells it: the modifiers in one order, then the name. The platform's own
 *  modifier is deliberately not in the spelling — `../invariants.test.ts` forbids the word outside the
 *  one file that rewrites it — so `edit` below refuses a key carrying it instead. */
const chordOf = (key: Press): string =>
  `${key.ctrl ? 'ctrl+' : ''}${key.meta ? 'meta+' : ''}${key.shift ? 'shift+' : ''}${key.name}`

/** What this key types, and empty for a key that types nothing.
 *
 *  A chord types nothing whatever byte it arrived as: Ctrl+A is a control character on a legacy
 *  terminal and would otherwise insert one. A control character types nothing either, which is what
 *  keeps Return, Tab and Escape out of the text — Return's newline is the table's decision below and
 *  not a character the terminal handed over (../input/events.ts § KeyEvent). */
function typedBy(key: Press): string {
  if (key.ctrl || key.meta || key.super) return ''
  let typed = ''
  for (const cluster of clusters(key.sequence ?? '')) {
    const code = cluster.text.codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) typed += cluster.text
  }
  return typed
}

/**
 * One key against a field, or `false` for a key the field does not take.
 *
 * `rows` are the visual rows of the current text at the current width, which the component holds
 * beside the model and rebuilds when either changes rather than per keystroke: a wrap of a 400-line
 * note is 163 microseconds, which is affordable per key and wasteful per frame
 * (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 4).
 *
 * `newline` is the whole of the difference between the two fields. An `Input` says no, and Return
 * then falls through to its component, which submits (./asking.tsx § Input).
 */
export function edit(
  field: Field, key: Press, rows: readonly Row[], newline: boolean,
): Field | false {
  // A key carrying the platform's own modifier is refused outright, because that modifier is not in
  // the chord spelling below and without this it would match its Ctrl twin. A terminal emulator on
  // macOS keeps that key for itself and never delivers it; where the kitty protocol does deliver it,
  // this table binds none of it (docs/tui.md § The adapter).
  if (key.super) return false
  if (newline && (key.name === 'return' || key.name === 'linefeed') && !key.ctrl && !key.meta) {
    return change(field, field.cursor, field.cursor, '\n')
  }
  const action = KEYS[chordOf(key)]
  if (action) return action(field, rows)
  const typed = typedBy(key)
  return typed === '' ? false : change(field, field.cursor, field.cursor, typed)
}

/** A paste, which is an insert of however much text arrived. An `Input` strips the newlines, the way
 *  `InputRenderable.handlePaste` does, so pasting three lines into a filter field filters by one line
 *  rather than three. */
export const paste = (field: Field, text: string, newline: boolean): Field =>
  change(field, field.cursor, field.cursor, newline ? text : text.replace(/[\n\r]+/g, ' '))
