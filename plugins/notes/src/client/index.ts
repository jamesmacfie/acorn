// The notes plugin's client part (docs/plugins.md § The plugin API). One pane: the note files
// live on the node under <data-root>/notes/, and the context pane's notes section is context's
// own contribution.
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { notesPaneContribution } from './NotesTaskPane'

export const notesClientPlugin: ClientPlugin = {
  name: 'notes',
  required: true,
  init: (ctx) => {
    ctx.panes.register(notesPaneContribution)
  },
}
