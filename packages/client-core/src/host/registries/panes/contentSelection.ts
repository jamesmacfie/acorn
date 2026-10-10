// What an owner needs to turn a person's selection into a `content.selection` target. JSX-free and
// DOM-free, so both hosts and every owner share it. See docs/plugins/menus-and-markers.md § Context menus.
import { MAX_SELECTION_BYTES } from '@acorn/protocol/contextMenus.ts'
import { utf8Exceeds } from '@acorn/protocol/extensionPoints.ts'
import type { SelectionRange } from './contextMenus'

/** Is this text over the 64 KiB of UTF-8 a selection action may be handed? */
export const selectionTooLarge = (text: string): boolean => utf8Exceeds(text, MAX_SELECTION_BYTES)

// The part of CodeMirror's `EditorState` this reads, so this module imports no editor.
type DocumentState = {
  selection: { main: { from: number; to: number } }
  doc: { lineAt: (pos: number) => { number: number; from: number } }
  sliceDoc: (from: number, to: number) => string
}

/** An editor's main selection: its text, and where it is as one-based lines and columns with an
 *  exclusive end, the convention the document routes already use. None when nothing is selected. */
export const documentSelection = (state: DocumentState): { text: string; range: SelectionRange } | undefined => {
  const { from, to } = state.selection.main
  if (from === to) return undefined
  const at = (pos: number) => {
    const line = state.doc.lineAt(pos)
    return { line: line.number, column: pos - line.from + 1 }
  }
  return { text: state.sliceDoc(from, to), range: { start: at(from), end: at(to) } }
}
