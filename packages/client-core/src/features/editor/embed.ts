import { basicSetup } from 'codemirror'
import { EditorState, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { LanguageId } from '@acorn/protocol/languageIds.ts'
import { languageFor } from './language'
import { editorTheme, watchEditorTheme } from './theme'

// A small editor inside somebody else's pane: a box of code that is not a document.
//
// The document surface next door is the whole machine — a plugin's read and write routes, autosave,
// view state, completions, surface chords (./DocumentSurface.tsx). None of that applies to a field
// whose text is already in hand and whose Apply button is right underneath it, and the two things a
// caller in that position still cannot get for itself are the editor library and the app's theme.
// So this is those two and nothing else: the caller keeps the text, and gets highlighting.
//
// It lives here rather than in a plugin because `@acorn/plugin-api/ui/editor` is the seam the
// terminal host already swaps out (apps/tui/src/kit/editor.ts). A plugin that imported CodeMirror
// directly would carry the library into a host that cannot draw it, which is the ceiling that file
// names.

export type EmbeddedEditor = {
  /** The text as it stands. */
  read: () => string
  /** Replace all of it — a Format or a Revert, not a keystroke. */
  write: (text: string) => void
  destroy: () => void
}

export function mountEmbeddedEditor(element: HTMLElement, options: {
  /** The text to start with. Later changes from outside go through `write`. */
  doc: string
  languageId: LanguageId
  readOnly?: boolean
  onChange?: (text: string) => void
}): EmbeddedEditor {
  const view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        basicSetup,
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
  // A box that highlights a moment late beats a box that is blank until it can (./language.ts).
  let gone = false
  void languageFor(options.languageId)
    .then((grammar) => { if (!gone) view.dispatch({ effects: StateEffect.appendConfig.of(grammar) }) })
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
