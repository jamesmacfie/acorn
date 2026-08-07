// The notes plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// What the composition root used to do by hand: plugins/memory's registerKnowledgeIpc constructed the
// NotesStore, apps/node/src/service/runtime.ts pulled that instance back out of the `memory.knowledge`
// capability and threaded it into three separate wiring calls (contextSectionsWiring, agentToolsWiring,
// the workflow wiring) plus the task-note seeder, and the four `notes_*` agent tools were declared in an
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
import { notesSection } from '@acorn/node-core/server/agentTools/contextSections.ts'
import type { NoteAuthor, NoteLocation, NoteScope } from '@acorn/protocol/notes.ts'
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
    // The `notes` context section. This closure is the whole body of what
    // apps/node/src/wiring/contextSectionsWiring.ts held on this plugin's behalf — the three-scope walk,
    // the empty-note skip and the workspace-note compatibility filter — moved verbatim to the plugin that
    // owns the files. Core keeps the section's budget and compact formatter.
    ctx.contextSections.register(
      notesSection(async (taskId) => {
        // `tasks` and `workspace_repos` are CORE's tables and this plugin has no handle to either, so the
        // workspace arrives through CoreServices rather than a query.
        //
        // `workspaceIdOrNull`, not `workspaceId(taskId).catch(() => null)`. Null is the right BEHAVIOUR here —
        // the wiring this replaces called `workspaceIdForRepo`, which returned null and skipped the workspace
        // scope, and letting it throw would fail prompt assembly for a repo the user has not put in a workspace
        // yet. But the bare catch bought that by swallowing everything: `workspaceId` throws for "task not
        // found", for "no membership" and for any real database failure alike, so a broken query became "this
        // task has no workspace" and every included workspace note dropped out of the prompt silently. A prompt
        // quietly missing its context is worse than a section that errors. Now only the two genuine cases
        // degrade, and a failure propagates.
        const workspaceId = await ctx.core.tasks.workspaceIdOrNull(taskId)
        const locations: { scope: NoteScope; location: NoteLocation }[] = [
          { scope: 'task', location: { scope: 'task', taskId } },
          ...(workspaceId ? [{ scope: 'workspace' as const, location: { scope: 'workspace' as const, workspaceId } }] : []),
          { scope: 'global', location: { scope: 'global' } },
        ]
        const out: { slug: string; scope: NoteScope; title: string; kind: string; body: string; author: NoteAuthor }[] = []
        for (const { scope, location } of locations) {
          for (const summary of await store.list(location)) {
            if (!summary.included) continue
            // Compatibility for pre-Phase-4 seeded workspace notes: keep the current task's rows, exclude
            // siblings. New task notes are isolated structurally by their directory.
            if (scope === 'workspace' && summary.originTaskId && summary.originTaskId !== taskId) continue
            const note = await store.read(location, summary.slug).catch(() => null)
            // Skip empty notes (an untouched scratchpad): they contribute only a `### title` of noise.
            if (note && note.body.trim()) {
              out.push({ slug: summary.slug, scope, title: `${note.title} (${note.kind})`, kind: note.kind, body: note.body, author: note.author })
            }
          }
        }
        return out
      }),
    )
  },
})
