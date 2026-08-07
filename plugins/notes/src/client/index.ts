// The notes plugin's client part (docs/plugins.md § The plugin API).
//
// One pane, and that is the whole client surface: the notes files themselves are the node's
// (`<data-root>/notes/`), and the context pane's note section is context's own contribution.
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { notesPaneContribution } from './NotesTaskPane'

export const notesClientPlugin: ClientPlugin = {
  name: 'notes',
  required: true,
  init: (ctx) => {
    ctx.panes.register(notesPaneContribution)
  },
}
