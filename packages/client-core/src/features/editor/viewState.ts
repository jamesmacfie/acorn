// Where the reader was, as data this app owns.
//
// Monaco handed back an opaque blob and asked for it back; CodeMirror has no such thing, and that is
// an improvement rather than a gap (docs/editor.md § View state). Selection and scroll are the whole
// of what a reader notices across a tab swap, so both call sites persist exactly that and nothing
// they cannot read.
import type { EditorView } from '@codemirror/view'

export type EditorViewState = { anchor: number; head: number; scrollTop: number }

export const captureViewState = (view: EditorView): EditorViewState => ({
  anchor: view.state.selection.main.anchor,
  head: view.state.selection.main.head,
  scrollTop: view.scrollDOM.scrollTop,
})

/**
 * Put a view back where it was. Offsets are clamped to the document, because the file on disk may
 * have moved under us between the stash and the restore — the agent and the human share a worktree,
 * so that is the ordinary case rather than the strange one.
 */
export function applyViewState(view: EditorView, state: EditorViewState): void {
  const end = view.state.doc.length
  view.dispatch({ selection: { anchor: Math.min(state.anchor, end), head: Math.min(state.head, end) } })
  view.scrollDOM.scrollTop = state.scrollTop
}
