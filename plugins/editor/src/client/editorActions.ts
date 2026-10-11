import type { EditorView } from '@codemirror/view'
import { openReplacePanel } from '@acorn/plugin-api/ui/editor'
import type * as Engine from './editorEngine'

export type EditorAction =
  | 'find'
  | 'replace'
  | 'comment'
  | 'duplicate'
  | 'move-up'
  | 'move-down'
  | 'select-next'
  | 'undo'
  | 'redo'
  | 'indent'
  | 'outdent'

export const EDITOR_ACTIONS: readonly { id: EditorAction; title: string }[] = [
  { id: 'find', title: 'Find in file' },
  { id: 'replace', title: 'Replace in file' },
  { id: 'comment', title: 'Toggle comment' },
  { id: 'duplicate', title: 'Duplicate line' },
  { id: 'move-up', title: 'Move line up' },
  { id: 'move-down', title: 'Move line down' },
  { id: 'select-next', title: 'Select next occurrence' },
  { id: 'undo', title: 'Undo edit' },
  { id: 'redo', title: 'Redo edit' },
  { id: 'indent', title: 'Indent selection' },
  { id: 'outdent', title: 'Outdent selection' },
]

export function actionAvailable(engine: typeof Engine, view: EditorView, action: EditorAction): boolean {
  if (!view.state.readOnly) {
    if (action === 'undo') return engine.undoDepth(view.state) > 0
    if (action === 'redo') return engine.redoDepth(view.state) > 0
    return true
  }
  return action === 'find' || action === 'select-next'
}

export function runEditorAction(engine: typeof Engine, view: EditorView, action: EditorAction): boolean {
  if (!actionAvailable(engine, view, action)) return false
  if (action === 'find' || action === 'replace') {
    return action === 'replace' ? openReplacePanel(view) : engine.openSearchPanel(view)
  }
  const operation = {
    comment: engine.toggleComment,
    duplicate: engine.copyLineDown,
    'move-up': engine.moveLineUp,
    'move-down': engine.moveLineDown,
    'select-next': engine.selectNextOccurrence,
    undo: engine.undo,
    redo: engine.redo,
    indent: engine.indentMore,
    outdent: engine.indentLess,
  }[action]
  return operation(view)
}
