import { describe, expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { defaultHighlightStyle, highlightingFor } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { editorTheme } from './theme'

// The one thing worth a test here: `basicSetup` registers CodeMirror's own light highlight style,
// and for a while ours sat behind it as a second fallback, where the facet keeps only the first
// value. Nothing failed, no colour appeared, and every markdown heading and link came out
// underlined. This is the check that fails if that comes back.
describe('editorTheme', () => {
  const state = EditorState.create({ extensions: [basicSetup, editorTheme()] })

  test('colours a heading with the app style, not the one basicSetup brings', () => {
    expect(highlightingFor(state, [tags.heading])).toBeTruthy()
    expect(highlightingFor(state, [tags.heading])).not.toBe(defaultHighlightStyle.style([tags.heading]))
  })

  test('has a rule for every markdown tag a document leans on', () => {
    for (const tag of [tags.link, tags.url, tags.monospace, tags.processingInstruction, tags.quote]) {
      expect(highlightingFor(state, [tag])).toBeTruthy()
    }
  })
})
