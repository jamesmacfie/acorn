import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { applyViewState, captureViewState } from './viewState'

// jsdom does no layout, so a Range cannot report rectangles and CodeMirror measures selections.
Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const view = (doc: string) => {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new EditorView({ state: EditorState.create({ doc }), parent })
}

describe('editor view state', () => {
  it('puts the reader back where they were', () => {
    const editor = view('one\ntwo\nthree\n')
    editor.dispatch({ selection: { anchor: 4, head: 7 } })
    const stashed = captureViewState(editor)
    editor.dispatch({ selection: { anchor: 0 } })

    applyViewState(editor, stashed)
    expect(editor.state.selection.main.anchor).toBe(4)
    expect(editor.state.selection.main.head).toBe(7)
    editor.destroy()
  })

  it('clamps to a document that shrank underneath it', () => {
    // The agent and the human share a worktree, so a file getting shorter between the stash and the
    // restore is ordinary. An unclamped offset is a thrown range error in the middle of a tab swap.
    const editor = view('one\ntwo\nthree\n')
    editor.dispatch({ selection: { anchor: 12 } })
    const stashed = captureViewState(editor)

    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'one\n' } })
    applyViewState(editor, stashed)
    expect(editor.state.selection.main.anchor).toBe(4)
    editor.destroy()
  })
})
