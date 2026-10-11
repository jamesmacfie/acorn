import { basicSetup } from 'codemirror'
import { EditorState, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { LanguageId } from '@acorn/protocol/languageIds.ts'
import { languageFor } from './language'
import { editorSearch } from './search'
import { editorTheme, watchEditorTheme } from './theme'

// A small editor inside somebody else's pane: a box of code that is not a document. Unlike
// `DocumentSurface` it has no routes, autosave, view state, completions or surface chords. The caller
// keeps the text and gets the two things it can't get for itself: the editor library and the app's theme.
//
// It lives here rather than in a plugin because `@acorn/plugin-api/ui/editor` is the seam the terminal
// host swaps out. A plugin that imported CodeMirror directly would carry the library into a host that
// can't draw it.

export type EmbeddedEditor = {
  /** The text as it stands. */
  read: () => string
  /** Replace all of it — a Format or a Revert, not a keystroke. */
  write: (text: string) => void
  destroy: () => void
}

export function mountEmbeddedEditor(
  element: HTMLElement,
  options: {
    /** The text to start with. Later changes from outside go through `write`. */
    doc: string
    languageId: LanguageId
    readOnly?: boolean
    onChange?: (text: string) => void
  },
): EmbeddedEditor {
  const view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        basicSetup,
        editorSearch(),
        editorTheme(),
        ...(options.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange?.(update.state.doc.toString())
        }),
      ],
    }),
  })
  const stopTheme = watchEditorTheme(view)
  // The grammar is a download of its own, so it arrives after the first paint and is appended then.
  // A box that highlights a moment late beats a box that is blank until it can.
  let gone = false
  void languageFor(options.languageId)
    .then((grammar) => {
      if (!gone) view.dispatch({ effects: StateEffect.appendConfig.of(grammar) })
    })
    .catch(() => {})
  return {
    read: () => view.state.doc.toString(),
    write: (text) => {
      if (text === view.state.doc.toString()) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    },
    destroy: () => {
      gone = true
      stopTheme()
      view.destroy()
    },
  }
}
