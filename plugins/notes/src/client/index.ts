// The notes plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// One pane, and that is the whole client surface: the notes files themselves are the node's
// (`<data-root>/notes/`), and the context pane's note section is context's own contribution.
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { notesPaneContribution } from './NotesTaskPane'

// `required: true`, matching the node half (core's context assembler resolves the notes section through
// it). Phase 4 made the node the only source of truth for which plugins are off, so a node can never
// report notes as disabled and a client-side disable was unreachable state.
export const notesClientPlugin: ClientPlugin = {
  name: 'notes',
  required: true,
  init: (ctx) => {
    ctx.panes.register(notesPaneContribution)
  },
}
