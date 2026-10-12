import { join } from 'node:path'
import { registerDeletedTaskPurge, type InternalEnvFactory, type NodePlugin } from '@acorn/plugin-api/node'
import { notesSection } from '../server/contextSection'
import { NOTES_SEED_TASK, NOTES_STORE } from '../contract/store'
import { NOTES_SPAWN_SNAPSHOT } from '../contract/spawnSnapshot'
import { includedNotes } from '../server/includedNotes'
import { captureSpawnNotes } from '../server/spawnSnapshot'
import { notesAgentTools } from '../server/agentTools'
import { NotesStore } from '../server/notes'
import { seedTaskNotes } from '../server/seedTaskNotes'
import { notes } from '../server/routes/notes'

export type NotesPluginDeps = { internalEnv: InternalEnvFactory }

export const notesPlugin = (dataDir: string, deps: NotesPluginDeps = { internalEnv: () => ({}) }): NodePlugin => ({
  name: 'notes',
  label: 'Notes',
  required: true,
  init: (ctx) => {
    const store = new NotesStore(join(dataDir, 'notes'), ctx.events.send)
    ctx.capabilities.provide(NOTES_STORE, store)
    // Seeding writes several notes in a row. It goes through a silent handle over the same directory
    // and announces once at the end, so a consumer hears one `notes-changed`, not one per note.
    const silent = new NotesStore(join(dataDir, 'notes'))
    ctx.capabilities.provide(NOTES_SEED_TASK, async (task) => {
      if (await seedTaskNotes(ctx.core, silent, deps.internalEnv({ scope: 'service' }), task))
        store.changed({ scope: 'task', taskId: task.id })
    })
    ctx.routes.register(notes, { prefix: '', note: 'notes CRUD' })
    registerDeletedTaskPurge(ctx, async (taskIds) =>
      (await import('../server/taskFolders')).removeTaskFolders(join(dataDir, 'notes'), taskIds),
    )
    // notes_list, notes_read, notes_write and notes_append, over the same store the pane and the context
    // assembler read. An agent appending a finding and the human reading it are looking at one file.
    for (const tool of notesAgentTools(store, ctx.core)) ctx.tools.register(tool)
    // The `notes` context section. This plugin owns the files, so it walks them. Core keeps the
    // section's budget and compact formatter.
    const workspaceIdOrNull = (taskId: string) => ctx.core.tasks.workspaceIdOrNull(taskId)
    ctx.contextSections.register(
      notesSection(async (taskId) =>
        (await includedNotes(store, workspaceIdOrNull, taskId)).notes.map(({ location, note }) => ({
          slug: note.slug,
          scope: location.scope,
          title: `${note.title} (${note.kind})`,
          kind: note.kind,
          body: note.body,
          author: note.author,
        })),
      ),
    )
    // The snapshot a delegated agent starts with. The agents plugin calls it while it queues the
    // child's first turn and keeps the result with that turn.
    ctx.capabilities.provide(NOTES_SPAWN_SNAPSHOT, (input) =>
      captureSpawnNotes(
        {
          store,
          workspaceIdOrNull,
          taskTitle: async (taskId) => (await ctx.core.tasks.load(taskId))?.title ?? null,
          // Assembling only the notes section is how a plugin asks core's snapshot hook. The login
          // picks linked issues, which this does not ask for.
          notesAllowed: async (taskId) =>
            !!(await ctx.core.context.assemble('', taskId, new Set(['notes'])))?.sections.some(
              (section) => section.id === 'notes',
            ),
        },
        input,
      ),
    )
  },
})
