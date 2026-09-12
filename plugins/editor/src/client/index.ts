// The editor plugin's client part (docs/plugins.md § The plugin API).
//
// One pane: find-in-files is a panel in its sidebar rather than a pane of its own
// (docs/panes.md § Contributions).
import { activeTaskId, type ClientPlugin } from '@acorn/plugin-api/client'
import { editorOpenFilesSlice } from './openFilesSlice'
// Imported for the side effect: claiming the `editor` WS prefix at boot rather than when the first
// file opens in terminal mode, so a typo is a failed assertion in wsChannelPrefixes.test.ts rather
// than a rectangle that stays blank.
import './wsChannel'
import { editorCommands } from './commands'
import { editorPaneContribution } from './paneContribution'

export const editorClientPlugin: ClientPlugin = {
  name: 'editor',
  init: (ctx) => {
    ctx.panes.register(editorPaneContribution)
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
    ctx.persistedStateSlices.register(editorOpenFilesSlice)
  },
}
