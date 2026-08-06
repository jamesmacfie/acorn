// The notes plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// What the composition root used to do by hand: plugins/memory's registerKnowledgeIpc constructed the
// NotesStore, apps/node/src/service/runtime.ts pulled that instance back out of the `memory.knowledge`
// capability and threaded it into three separate wiring calls (contextSectionsWiring, agentToolsWiring,
// workflowWiring) plus the task-note seeder, and the four `notes_*` agent tools were declared in an
// app-layer file holding every unconvertible plugin's deps in one bag. All of that is here now.
//
// **No database.** Notes are plain markdown files with a frontmatter block under
// `<data-root>/notes/<scope-key>/` (main/notes.ts) — human-editable by hand, and gitignored working
// state by design. That is not a gap to close later: an index would be a second copy of the truth, and
// the pane reads at most a few dozen files. Hence no `dispose` either — there is no WAL-mode file to
// close, no timer to clear, and no bridge slot to null out, because this plugin registers no routes.
//
// `required: true`, for the same reason memory and terminal are: core's context assembler resolves the
// store on every `/v2/core/tasks/:id/context` read, the workflow runner writes its per-run handoff note
// through it, and task creation seeds PR/ticket snapshots into it. A node with notes disabled would boot
// and then fail at the first task, which is not a configuration worth supporting.
import { join } from 'node:path'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { NOTES_STORE } from '../contract/store'
import { notesAgentTools } from '../main/agentTools'
import { NotesStore } from '../main/notes'

export const notesPlugin = (dataDir: string): NodePlugin => ({
  name: 'notes',
  required: true,
  init: (ctx) => {
    // ONE store, constructed here and nowhere else. Its writes are temp-file + rename, so two instances
    // over the same root would be two independent atomic-write schemes racing on one directory — which
    // is why "the same instance everywhere" used to be enforced by hand through the dep bag.
    //
    // Beside `worktrees/`, not under `plugins/`: that directory is for per-plugin SQLite files
    // (main/pluginStorage.ts), and moving these files would orphan every note in an existing data root.
    const store = new NotesStore(join(dataDir, 'notes'))
    ctx.capabilities.provide(NOTES_STORE, store)
    // notes_list / notes_read / notes_write / notes_append, over the SAME store the pane and the context
    // assembler read. An agent appending a finding and the human reading it are looking at one file.
    for (const tool of notesAgentTools(store, ctx.core)) ctx.tools.register(tool)
  },
})
