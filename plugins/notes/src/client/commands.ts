import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { NoteLocation, NoteScope, NoteSummary } from '@acorn/protocol/notes.ts'
import {
  COMMAND_CLOSED,
  localSearch,
  type CommandExecutionContext,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { notesApi, requestNoteOpen } from './notesClient'

// Notes in the palette: find one across all three scopes, and start a new one on this task
// (docs/notes-and-memory.md § From the command palette).
//
// **One search over three lists.** A reader looking for "the deploy runbook" does not know whether
// they filed it against this task, this workspace or globally, and the pane draws all three in one
// column anyway (./NotesPane.tsx). The three lists load once when the frame opens and are filtered
// here (client-core/host/registries/commands/localSearch.ts).
//
// **Ids are scope-qualified, and that is load-bearing.** A slug is unique inside a scope and nowhere
// else, so `deploy` can exist as a task note and a global one at the same time. `task:deploy` and
// `global:deploy` are two rows; a bare slug would make one of them unreachable and send the other's
// selection to the wrong file.
//
// Deleting a note and changing whether an agent sees it stay in the pane, where the scope and the
// current value are both on screen (docs/command-palette-and-shortcuts.md).

const SCOPES: readonly NoteScope[] = ['task', 'workspace', 'global']

/** The three places a note can live, for the identity this session captured. `null` where the session
 *  has no such identity — a task with no resolved workspace has no workspace list to read, which is
 *  the same guard the pane's own `locationFor` applies. */
const locationFor = (scope: NoteScope, context: CommandExecutionContext): NoteLocation | null => {
  if (scope === 'global') return { scope: 'global' }
  if (scope === 'task') return context.taskId ? { scope: 'task', taskId: context.taskId } : null
  return context.workspaceId ? { scope: 'workspace', workspaceId: context.workspaceId } : null
}

/** The pane's own filter: a workflow's scratch seed is machinery rather than something anybody wrote,
 *  and it is hidden in the list for the same reason (./notesModel.ts). */
const notSeed = (note: NoteSummary): boolean => !(note.author === 'workflow' && note.kind === 'scratch')

const noteItem = (scope: NoteScope, note: NoteSummary): CommandSearchItem => ({
  id: `${scope}:${note.slug}`,
  title: note.title,
  subtitle: note.kind === 'scratch' ? scope : `${scope} · ${note.kind}`,
  ref: note.slug,
})

/** A scope whose list would not come back, as a row. A workspace list is device-gated on the node, so
 *  an agent-confined client is refused rather than broken, and saying so beats an unexplained gap. */
type ScopeList = { scope: NoteScope; rows: NoteSummary[] } | { scope: NoteScope; error: string }

const problemItem = (scope: NoteScope, message: string): CommandSearchItem => ({
  id: `problem:${scope}`,
  title: `${scope} notes: ${message}`,
  badge: 'error',
})

export const notesCommands: readonly ContributedCommand[] = [
  {
    id: 'notes.find',
    kind: 'search',
    title: 'Find a note',
    hint: 'this task’s, this workspace’s and the global ones',
    keywords: ['note', 'scratchpad'],
    category: 'navigation',
    palette: true,
    // Task-scoped because opening a note is a pane intent addressed at a task, even for a global note.
    scope: 'task',
    requires: { plugin: 'notes' },
    placeholder: 'Find a note…',
    ...localSearch(async (context) => {
      const api = notesApi()
      const lists = await Promise.all(SCOPES.map(async (scope): Promise<ScopeList> => {
        const location = locationFor(scope, context)
        if (!location) return { scope, rows: [] }
        const result = await api.list(location)
        return 'error' in result ? { scope, error: result.error } : { scope, rows: result }
      }))
      return lists.flatMap((list) =>
        'error' in list ? [problemItem(list.scope, list.error)] : list.rows.filter(notSeed).map((note) => noteItem(list.scope, note)))
    }),
    select: (item, context): CommandOutcome => {
      const taskId = context.taskId
      if (!taskId || !item.ref) return { effect: 'stay', status: item.title }
      // The retained intent the pane already answers, so the note opens whether the pane is mounted
      // or opens because of this (./notesClient.ts).
      requestNoteOpen(taskId, item.ref, item.id.slice(0, item.id.indexOf(':')) as NoteScope)
      return COMMAND_CLOSED
    },
  },
  {
    id: 'notes.create',
    kind: 'input',
    title: 'Create a task note',
    hint: 'a note filed against this task',
    keywords: ['note', 'new'],
    category: 'action',
    palette: true,
    scope: 'task',
    requires: { plugin: 'notes' },
    placeholder: 'Title the note…',
    submit: async (text, context): Promise<CommandOutcome> => {
      const taskId = context.taskId
      if (!taskId) return COMMAND_CLOSED
      // No kind and no slug: the node owns both, so the default kind and the `name-2`, `name-3`
      // collision rule are the ones the pane's own `+` button gets (../server/notes.ts).
      const created = await notesApi().create({ scope: 'task', taskId }, text)
      if ('error' in created) throw new Error(created.error)
      requestNoteOpen(taskId, created.slug, 'task')
      return COMMAND_CLOSED
    },
  },
]
