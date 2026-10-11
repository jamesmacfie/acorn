// The editor plugin's client part (docs/plugins/plugin-api.md § The plugin API).
//
// One pane: find-in-files is a panel in its sidebar rather than a pane of its own
// (docs/panes/contributions.md § Contributions).
import { lazy } from 'solid-js'
import { activeTaskId, type ClientPlugin } from '@acorn/plugin-api/client'
import { editorOpenFilesSlice } from './openFilesSlice'
// Imported for the side effect: claiming the `editor` WS prefix at boot rather than when the first
// file opens in terminal mode, so a typo is a failed assertion in wsChannelPrefixes.test.ts rather
// than a rectangle that stays blank.
import './wsChannel'
import { editorCommands } from './commands'
import { editorPaneContribution } from './paneContribution'
import { EDITOR_FILE_KEY, MAX_EDITOR_FILE_MARKS } from '../contract/fileAnnotations'

const EditorSettings = lazy(() => import('./EditorSettings'))

export const editorClientPlugin: ClientPlugin = {
  name: 'editor',
  init: (ctx) => {
    ctx.panes.register(editorPaneContribution)
    // Another plugin's view of the open file, such as a markdown preview (docs/editor/file-renderers.md).
    // One view replaces the document, and the pane keeps its own text view one Source toggle away.
    ctx.extensionPoints.register({
      id: 'document',
      label: 'Editor document',
      kind: 'remote',
      mode: 'replace',
      max: 1,
    })
    // What another plugin knows about a file the tree or a tab is drawing: a review, coverage, a
    // generated-file warning (docs/editor/file-annotations.md).
    ctx.extensionPoints.register({
      id: 'file',
      label: 'Editor file',
      kind: 'annotation',
      key: [...EDITOR_FILE_KEY],
      acceptedMarks: MAX_EDITOR_FILE_MARKS,
    })
    ctx.settingsPages.register({
      id: 'editor',
      label: 'Editor',
      category: 'features',
      scope: 'device',
      icon: 'file-code',
      order: 20,
      requires: { plugin: 'editor' },
      keywords: ['word wrap', 'indentation', 'spaces', 'tabs'],
      sections: [{ id: 'defaults', label: 'Editing defaults', rows: ['Word wrap', 'Indentation'] }],
      component: EditorSettings,
    })
    // ⌘P quick-open and find-in-files (./commands.ts). Quick-open was an overlay slot of its own
    // until 2026-09-03; it is a search command on the shared session now, so the chord opens the
    // palette at its frame instead of a second dialog with its own query and cursor.
    for (const contribution of editorCommands) ctx.commands.register(contribution)
    ctx.keybindings.register({
      id: 'editor.files.open',
      command: 'editor.files.open',
      description: 'Go to file',
      category: 'Global',
      // `global` with an `active` gate, which is the scope and the gate the overlay's own binding
      // carried. What changed is the command it names, not when it fires.
      defaultChord: 'meta+p',
      when: 'global',
      active: () => !!activeTaskId(),
    })
    ctx.keybindings.register({
      id: 'editor.search.open',
      command: 'editor.search.open',
      description: 'Find in files',
      category: 'Panes',
      defaultChord: 'meta+shift+f',
      when: 'task',
    })
    for (const binding of [
      { id: 'editor.toggle-word-wrap', description: 'Toggle word wrap', defaultChord: 'meta+alt+w' },
      { id: 'editor.tabs.reopen-closed', description: 'Reopen closed file', defaultChord: 'meta+shift+t' },
      { id: 'editor.navigation.back', description: 'Go back in editor', defaultChord: 'alt+left' },
      { id: 'editor.navigation.forward', description: 'Go forward in editor', defaultChord: 'alt+right' },
    ])
      ctx.keybindings.register({ ...binding, command: binding.id, category: 'Editor', when: 'pane', pane: 'editor' })
    ctx.persistedStateSlices.register(editorOpenFilesSlice)
  },
}
