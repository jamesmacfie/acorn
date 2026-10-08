import { afterEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import * as engine from './editorEngine'
import { actionAvailable, runEditorAction, type EditorAction } from './editorActions'

Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const views: EditorView[] = []
afterEach(() => { for (const view of views.splice(0)) view.destroy() })
const makeView = (readOnly = false) => {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    state: EditorState.create({ doc: 'first\nsecond\n', extensions: [engine.basicSetup, EditorState.readOnly.of(readOnly)] }),
    parent,
  })
  views.push(view)
  return view
}

describe('editor actions', () => {
  it('uses engine availability for read-only and undo state', () => {
    const editable = makeView()
    const readOnly = makeView(true)
    const availability: readonly [EditorAction, boolean, boolean][] = [
      ['find', true, true], ['replace', true, false], ['comment', true, false],
      ['duplicate', true, false], ['move-up', true, false], ['move-down', true, false],
      ['select-next', true, true], ['undo', false, false], ['redo', false, false],
      ['indent', true, false], ['outdent', true, false],
    ]
    for (const [action, canEdit, canRead] of availability) {
      expect(actionAvailable(engine, editable, action)).toBe(canEdit)
      expect(actionAvailable(engine, readOnly, action)).toBe(canRead)
    }
    editable.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(actionAvailable(engine, editable, 'undo')).toBe(true)
    expect(runEditorAction(engine, editable, 'undo')).toBe(true)
    expect(editable.state.doc.toString()).toBe('first\nsecond\n')
    expect(actionAvailable(engine, editable, 'redo')).toBe(true)
  })

  it('routes edits and selection through the admitted view without writing another state', () => {
    const view = makeView()
    const other = makeView()
    expect(runEditorAction(engine, view, 'duplicate')).toBe(true)
    expect(view.state.doc.toString()).toBe('first\nfirst\nsecond\n')
    expect(other.state.doc.toString()).toBe('first\nsecond\n')
    expect(runEditorAction(engine, view, 'select-next')).toBe(true)
    expect(view.state.doc.toString()).toBe('first\nfirst\nsecond\n')
  })
})
