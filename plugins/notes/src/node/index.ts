import { join } from 'node:path'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { notesSection } from '@acorn/node-core/server/agentTools/contextSections.ts'
import type { NoteAuthor, NoteLocation, NoteScope } from '@acorn/protocol/notes.ts'
import type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import { NOTES_SEED_TASK, NOTES_STORE } from '../contract/store'
import { notesAgentTools } from '../main/agentTools'
import { NotesStore } from '../main/notes'
import { seedTaskNotes } from '../main/seedTaskNotes'
import { notes } from '../server/routes/notes'

export type NotesPluginDeps = { internalEnv: InternalEnvFactory }

export const notesPlugin = (dataDir: string, deps: NotesPluginDeps = { internalEnv: () => ({}) }): NodePlugin => ({
  name: 'notes',
  required: true,
  init: (ctx) => {
    const store = new NotesStore(join(dataDir, 'notes'))
    ctx.capabilities.provide(NOTES_STORE, store)
    ctx.capabilities.provide(NOTES_SEED_TASK, (task) => seedTaskNotes(ctx.core, store, deps.internalEnv({ scope: 'service' }), task))
    ctx.routes.register(notes, { prefix: '', note: 'notes CRUD' })
    // notes_list / notes_read / notes_write / notes_append, over the SAME store the pane and the context
    // assembler read. An agent appending a finding and the human reading it are looking at one file.
    for (const tool of notesAgentTools(store, ctx.core)) ctx.tools.register(tool)
    // The `notes` context section. This closure is the whole body of what
    // apps/node/src/wiring/contextSectionsWiring.ts held on this plugin's behalf — the three-scope walk,
    // the empty-note skip and the workspace-note compatibility filter — moved verbatim to the plugin that
    // owns the files. Core keeps the section's budget and compact formatter.
    ctx.contextSections.register(
      notesSection(async (taskId) => {
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
            // Keep the current task's rows and exclude sibling task notes. New task notes are isolated
            // structurally by their directory.
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
