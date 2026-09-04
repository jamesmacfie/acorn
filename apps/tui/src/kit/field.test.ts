import { describe, expect, it } from 'vitest'
import { fromVisual, toVisual, wrapRows } from '../wrap'
import { byChar, byGroup, create, edit, paste, setValue, type Field, type Press } from './field'

// The field model and the wrap under it, on their own. No painter, no Yoga and no OpenTUI, so this
// file runs on the Node the repo pins with no flag — which is the point of the model being a string
// and two numbers rather than somebody's edit buffer.
//
// While the model was being chosen it was written twice, once over `@codemirror/state` and once over
// a string, against one file of 40 assertions; this is that file's shape kept, against the version
// that shipped (./field.ts).

/** A key as the dispatcher hands one over: a name, and the character it types where it types one. */
const key = (name: string, modifiers: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {}): Press =>
  ({ name, sequence: name.length === 1 ? name : '', ...modifiers })

/** One key against a field, wrapping at a width. Throws rather than returning `false`, because a
 *  case that meant to press a key the table does not take should say so. */
function press(field: Field, at: Press, width = Infinity, newline = true): Field {
  const next = edit(field, at, wrapRows(field.text, width), newline)
  if (next === false) throw new Error(`the field did not take ${at.name}`)
  return next
}

const took = (field: Field, at: Press, width = Infinity, newline = true): boolean =>
  edit(field, at, wrapRows(field.text, width), newline) !== false

describe('the wrap', () => {
  it('breaks after the last space that fits and keeps every offset in exactly one row', () => {
    const text = 'one two three four five six'
    const rows = wrapRows(text, 12)
    expect(rows.map((row) => text.slice(row.from, row.to))).toEqual(['one two ', 'three four ', 'five six'])
    // Contiguous and complete, which is the property the caret depends on: a wrap that dropped the
    // space it broke at would put the caret a cell out for the rest of the line (../wrap.ts).
    expect(rows.map((row) => text.slice(row.from, row.to)).join('')).toBe(text)
  })

  it('hard-breaks a word too long for a row of its own', () => {
    const text = 'aaaaaaaaaa'
    expect(wrapRows(text, 4).map((row) => text.slice(row.from, row.to))).toEqual(['aaaa', 'aaaa', 'aa'])
  })

  it('counts a wide character as two cells rather than one', () => {
    // The fault the width table exists to prevent, arriving through wrapping rather than truncation:
    // by `String.length` this row would hold twice the characters and overrun the terminal
    // (../width.ts).
    const text = '日本語のテキスト'
    expect(wrapRows(text, 8).map((row) => text.slice(row.from, row.to))).toEqual(['日本語の', 'テキスト'])
  })

  it('gives an empty document one row, and a trailing newline a row of its own', () => {
    expect(wrapRows('', 10)).toEqual([{ from: 0, to: 0 }])
    // Which is where the caret goes when you press Return at the end, and a wrap that dropped the row
    // would have nowhere to draw it.
    expect(wrapRows('a\n', 10)).toEqual([{ from: 0, to: 1 }, { from: 2, to: 2 }])
  })

  it('gives an offset at a soft break two homes, and `assoc` picks one', () => {
    const text = 'one two'
    const rows = wrapRows(text, 4)
    expect(toVisual(text, rows, 4, 0)).toEqual({ row: 1, col: 0 })
    // The row that *ends* there, which is what End on a wrapped row has to leave the caret on: without
    // it, End followed by Home does not come back.
    expect(toVisual(text, rows, 4, -1)).toEqual({ row: 0, col: 4 })
  })

  it('clamps a column past the end of a row to that row\'s end', () => {
    const text = 'alpha\nab'
    const rows = wrapRows(text, 10)
    expect(fromVisual(text, rows, 1, 4)).toBe(text.length)
  })
})

describe('a field', () => {
  it('inserts what a key types and nothing a chord does', () => {
    let field = create('')
    field = press(field, key('a'))
    field = press(field, { name: 'space', sequence: ' ' })
    field = press(field, key('b'))
    expect(field.text).toBe('a b')
    expect(field.cursor).toBe(3)
    // A chord types nothing whatever byte it arrived as, which is what keeps Ctrl+A from inserting a
    // control character on a legacy terminal (./field.ts § typedBy).
    expect(took(field, { name: 'q', ctrl: true, sequence: 'q' })).toBe(false)
    // …and neither does Return, Tab or Escape: the name decides what those do.
    expect(took(field, { name: 'escape', sequence: '\x1b' })).toBe(false)
  })

  it('takes Return as a newline in a textarea and refuses it in a one-row field', () => {
    expect(press(create('ab'), key('return')).text).toBe('ab\n')
    // Refused, so the component can submit instead, which is `InputRenderable`'s one changed binding.
    expect(took(create('ab'), key('return'), Infinity, false)).toBe(false)
    // And `ctrl+return` is `commit` and stays the dispatcher's, both ways round.
    expect(took(create('ab'), key('return', { ctrl: true }))).toBe(false)
  })

  it('deletes backwards and forwards by cluster, over a line break at either end', () => {
    expect(press(create('abc'), key('backspace')).text).toBe('ab')
    expect(press(create('a\nb', 2), key('backspace')).text).toBe('ab')
    expect(press(create('abc', 1), key('delete')).text).toBe('ac')
    expect(press(create('a\nb', 1), key('delete')).text).toBe('ab')
    // A grapheme rather than a code unit: an accent goes with the letter it hangs off, and an astral
    // character goes whole (../width.ts § clusters).
    expect(press(create('aé'), key('backspace')).text).toBe('a')
    expect(press(create('a\u{1f600}'), key('backspace')).text).toBe('a')
  })

  it('moves and deletes by word, stopping between the three categories', () => {
    expect(byGroup('one two three', 13, false)).toBe(8)
    expect(byGroup('one two three', 0, true)).toBe(3)
    // Past the leading space first, which is what a reader means by "the next word".
    expect(byGroup('one   two', 3, true)).toBe(9)
    expect(press(create('one two'), { name: 'w', ctrl: true }).text).toBe('one ')
    expect(press(create('one two', 0), { name: 'd', meta: true }).text).toBe(' two')
    for (const chord of [{ name: 'left', ctrl: true }, { name: 'left', meta: true }, { name: 'b', meta: true }]) {
      expect(press(create('one two'), chord).cursor).toBe(4)
    }
  })

  it('puts Home and End on the visual line rather than the document', () => {
    // The deliberate departure from `defaultTextareaKeyBindings`, where both are the whole buffer and
    // the line boundaries sit on Ctrl+A and Ctrl+E. Both spellings reach the visual line here, because
    // that is what a reader in a wrapped composer means by the key (./field.ts).
    const text = 'one two three'
    for (const chord of [key('home'), { name: 'a', ctrl: true }, { name: 'a', meta: true }]) {
      expect(press(create(text), chord, 8).cursor).toBe(8)
    }
    for (const chord of [key('end'), { name: 'e', ctrl: true }, { name: 'e', meta: true }]) {
      expect(press(create(text, 0), chord, 8).cursor).toBe(8)
    }
    // End then Home comes back, which is the whole reason the model carries `assoc`.
    const there = press(create(text, 0), key('end'), 8)
    expect(press(there, key('home'), 8).cursor).toBe(0)
  })

  it('kills to either end of the logical line, and the whole of it', () => {
    // The logical line rather than the visual row, because that is what these do in a shell.
    expect(press(create('one two three', 4), { name: 'k', ctrl: true }, 8).text).toBe('one ')
    expect(press(create('one two three', 4), { name: 'u', ctrl: true }, 8).text).toBe('two three')
    expect(press(create('a\nbb\nc', 3), { name: 'd', ctrl: true, shift: true }).text).toBe('a\n\nc')
  })

  it('moves up and down over the visual rows, keeping a goal column', () => {
    const text = 'alpha\nab\nbravo'
    // Onto a short row and out the other side at the column it left, which is what the goal is for.
    const down = press(press(create(text, 4), key('down')), key('down'))
    expect(down.cursor).toBe(13)
    expect(press(create(text, 7), key('up')).cursor).toBe(1)
    // And nothing at all where there is no such row, which is what makes a one-row field inert on the
    // vertical pair without a table of its own (docs/tui.md § The five key groups).
    expect(took(create('ab', 1), key('up'), Infinity, false)).toBe(false)
    expect(took(create('ab', 1), key('down'), Infinity, false)).toBe(false)
  })

  it('steps left and right by cluster, over a line break', () => {
    expect(byChar('a\nb', 1, true)).toBe(2)
    expect(byChar('a\nb', 2, false)).toBe(1)
    expect(byChar('aéb', 1, true)).toBe(3)
    // And stops at either end rather than running off it.
    expect(byChar('ab', 0, false)).toBe(0)
    expect(byChar('ab', 2, true)).toBe(2)
  })

  it('takes a paste whole, and flattens it for a one-row field', () => {
    expect(paste(create(''), 'one\ntwo', true).text).toBe('one\ntwo')
    // The way `InputRenderable.handlePaste` strips newlines: a filter field has nowhere to put the
    // second line, and a filter matching a newline matches nothing.
    expect(paste(create(''), 'one\ntwo', false).text).toBe('one two')
  })

  it('keeps a caret that was at the end at the end when the value is written in', () => {
    // Which is what a controlled field needs: the component writes the value back on every keystroke,
    // and a caret pinned to an offset would fall behind by a character per key (./field.ts § setValue).
    expect(setValue(create('ab'), 'abc').cursor).toBe(3)
    expect(setValue(create('abc', 1), 'abcd').cursor).toBe(1)
    // And never past the end of the new value.
    expect(setValue(create('abcd', 3), 'a').cursor).toBe(1)
  })

  it('refuses a chord carrying the platform\'s own modifier rather than matching its Ctrl twin', () => {
    // A terminal emulator on macOS keeps that key and never delivers it; where the kitty protocol
    // does, this table binds none of it (docs/tui.md § The adapter).
    expect(took(create('one two'), { name: 'left', super: true })).toBe(false)
  })
})
