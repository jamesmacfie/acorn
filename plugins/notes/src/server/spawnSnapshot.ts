import { z } from 'zod'
import { formatOmitted, truncateBytes } from '@acorn/plugin-api/node'
import { NOTE_SCOPE_LABEL, type NoteLocation } from '@acorn/protocol/notes.ts'
import type { NotesStoreCapability } from '../contract/store'
import type { SpawnNotesCapture, SpawnNotesSnapshot } from '../contract/spawnSnapshot'
import { NOTES_CONTEXT_BUDGET } from './contextSection'
import { includedNotes } from './includedNotes'

// One captured note. It is stored with the child's first turn and read back when that child
// delegates, so it is parsed rather than trusted.
const spawnNoteSchema = z.object({
  scope: z.enum(['task', 'workspace', 'global']),
  // The task or workspace the note belongs to. A global note has none.
  ownerId: z.string().optional(),
  // The owning task's title, so a later generation can still name where an inherited note came from.
  taskTitle: z.string().optional(),
  slug: z.string(),
  title: z.string(),
  body: z.string(),
})
type SpawnNote = z.infer<typeof spawnNoteSchema>

// Where a note lives. The same slug in two places is two notes.
const sourceOf = (note: Pick<SpawnNote, 'scope' | 'ownerId'>): string =>
  note.ownerId ? `${note.scope}:${note.ownerId}` : note.scope
const ownerOf = (location: NoteLocation): string | undefined =>
  location.scope === 'task' ? location.taskId : location.scope === 'workspace' ? location.workspaceId : undefined

const SCOPE_ORDER = { task: 0, workspace: 1, global: 2 } as const

type Deps = {
  store: Pick<NotesStoreCapability, 'list' | 'read'>
  workspaceIdOrNull: (taskId: string) => Promise<string | null>
  taskTitle: (taskId: string) => Promise<string | null>
  // Whether core's `core:before-snapshot` hook lets notes into this task's context.
  notesAllowed: (taskId: string) => Promise<boolean>
}

export async function captureSpawnNotes(
  deps: Deps,
  input: Parameters<SpawnNotesCapture>[0],
): Promise<SpawnNotesSnapshot> {
  const capturedAt = Date.now()
  // The snapshot is the child task's context, so a hook that keeps notes out of it keeps them all out.
  if (!(await deps.notesAllowed(input.taskId))) return { content: '', notes: [], capturedAt }
  const taskIds = [input.taskId]
  if (input.parentTaskId && input.parentTaskId !== input.taskId) taskIds.push(input.parentTaskId)
  const fresh: SpawnNote[] = []
  const covered = new Set<string>()
  const unreadable: string[] = []
  for (const taskId of taskIds) {
    const walk = await includedNotes(deps.store, deps.workspaceIdOrNull, taskId)
    const taskTitle = (await deps.taskTitle(taskId)) ?? taskId
    unreadable.push(...walk.unreadable)
    for (const location of walk.locations) covered.add(sourceOf({ scope: location.scope, ownerId: ownerOf(location) }))
    for (const { location, note } of walk.notes) {
      fresh.push({
        scope: location.scope,
        ownerId: ownerOf(location),
        ...(location.scope === 'task' ? { taskTitle } : {}),
        slug: note.slug,
        title: `${note.title} (${note.kind})`,
        body: note.body,
      })
    }
  }
  // A source read just now replaces what the delegating session inherited from it, so a note deleted
  // or excluded since then stays out.
  const inherited = (Array.isArray(input.inherited) ? input.inherited : []).flatMap((value) => {
    const parsed = spawnNoteSchema.safeParse(value)
    return parsed.success && !covered.has(sourceOf(parsed.data)) ? [parsed.data] : []
  })
  const seen = new Set<string>()
  const all = [...fresh, ...inherited]
    .filter((note) => {
      const key = `${sourceOf(note)}:${note.slug}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope])

  // One budget for the whole snapshot, applied after duplicates are gone, so a longer chain of
  // delegating tasks cannot widen it.
  const { maxItems, maxBytesPerItem } = NOTES_CONTEXT_BUDGET
  const notes = all.slice(0, maxItems).map((note) => ({ ...note, body: truncateBytes(note.body, maxBytesPerItem) }))
  const truncated = notes.filter((note, index) => note.body !== all[index].body).length
  if (!notes.length && !unreadable.length) return { content: '', notes: [], capturedAt }

  const ownTitle = (await deps.taskTitle(input.taskId)) ?? input.taskId
  const isInherited = (note: SpawnNote) => note.scope === 'task' && note.ownerId !== input.taskId
  const content = [
    `Acorn attached these notes when this delegated session started. They were captured at ${new Date(capturedAt).toISOString()}, and later edits to the notes do not reach this session.`,
    `Your task is “${ownTitle}”.${
      notes.some(isInherited)
        ? ' A note marked “inherited” comes from a task that delegated this work to you. It carries that task’s guidance, but that task’s branch and worktree are not yours.'
        : ''
    }`,
    'Use these notes as supporting context for your task.',
    '',
    '## Notes',
    ...notes.flatMap((note) => [
      `### ${note.title}`,
      `_Scope: ${NOTE_SCOPE_LABEL[note.scope].toLowerCase()}${isInherited(note) ? `, inherited from task “${note.taskTitle ?? note.ownerId}”` : ''}_`,
      note.body.trim(),
    ]),
  ].join('\n')
  const footer = [
    formatOmitted(all.length - notes.length),
    truncated ? `\n- ${truncated} note${truncated === 1 ? ' was' : 's were'} cut to ${maxBytesPerItem} bytes.` : '',
    unreadable.length ? `\n- Could not read: ${unreadable.map((title) => `“${title}”`).join(', ')}.` : '',
  ].join('')
  return { content: content + footer, notes, capturedAt }
}
