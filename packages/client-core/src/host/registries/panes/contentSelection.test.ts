import { describe, expect, it } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { documentSelection, selectionTooLarge } from './contentSelection'

describe('selectionTooLarge', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(selectionTooLarge('a'.repeat(64 * 1024))).toBe(false)
    expect(selectionTooLarge('a'.repeat(64 * 1024 + 1))).toBe(true)
    // Three bytes each: 21,845 fit and 21,846 do not.
    expect(selectionTooLarge('€'.repeat(21_845))).toBe(false)
    expect(selectionTooLarge('€'.repeat(21_846))).toBe(true)
    // Four bytes in two UTF-16 units each.
    expect(selectionTooLarge('😀'.repeat(16_384))).toBe(false)
    expect(selectionTooLarge('😀'.repeat(16_385))).toBe(true)
  })
})

describe('documentSelection', () => {
  const state = (doc: string, anchor: number, head: number) =>
    EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })

  it('gives the main selection one-based, with an exclusive end, either way round', () => {
    const doc = 'first\nsecond line\nthird'
    const forward = documentSelection(state(doc, 6, 12))
    expect(forward).toEqual({ text: 'second', range: { start: { line: 2, column: 1 }, end: { line: 2, column: 7 } } })
    expect(documentSelection(state(doc, 12, 6))).toEqual(forward)
    expect(documentSelection(state(doc, 3, 20))).toEqual({
      text: 'st\nsecond line\nth',
      range: { start: { line: 1, column: 4 }, end: { line: 3, column: 3 } },
    })
  })

  it('has nothing for an empty selection', () => {
    expect(documentSelection(state('abc', 1, 1))).toBeUndefined()
  })
})
