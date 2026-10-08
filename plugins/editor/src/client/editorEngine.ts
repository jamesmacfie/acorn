// Loaded only after a DOM editor Rectangle admits its surface.
export { basicSetup } from 'codemirror'
export { Compartment, EditorState, Prec, StateEffect } from '@codemirror/state'
export { EditorView, keymap } from '@codemirror/view'
export { indentUnit } from '@codemirror/language'
export { copyLineDown, indentLess, indentMore, moveLineDown, moveLineUp, redo, redoDepth, toggleComment, undo, undoDepth } from '@codemirror/commands'
export { openSearchPanel, selectNextOccurrence } from '@codemirror/search'
export { lineMarkerEffect, lineMarkerExtension } from './lineMarkerExtension'
