import type { Note, NoteLocation } from '@acorn/protocol/notes.ts'
import type { NotesStoreCapability } from '../contract/store'

export type IncludedNote = { location: NoteLocation; note: Note }

/**
 * The notes an agent working in a task is given: the task's own, its workspace's, then global ones,
 * keeping only notes marked "Include in context" that have a body. A workspace note seeded by another
 * task stays out. New task notes are isolated by their directory, and this filter covers the older
 * ones that still live in the workspace folder.
 *
 * `locations` lists every place the walk read, so a caller can tell which sources it covered.
 * `unreadable` names notes that were listed but failed to read.
 */
export async function includedNotes(
  store: Pick<NotesStoreCapability, 'list' | 'read'>,
  workspaceIdOrNull: (taskId: string) => Promise<string | null>,
  taskId: string,
): Promise<{ notes: IncludedNote[]; locations: NoteLocation[]; unreadable: string[] }> {
  const workspaceId = await workspaceIdOrNull(taskId)
  const locations: NoteLocation[] = [
    { scope: 'task', taskId },
    ...(workspaceId ? [{ scope: 'workspace' as const, workspaceId }] : []),
    { scope: 'global' },
  ]
  const notes: IncludedNote[] = []
  const unreadable: string[] = []
  for (const location of locations) {
    for (const summary of await store.list(location)) {
      if (!summary.included) continue
      if (location.scope === 'workspace' && summary.originTaskId && summary.originTaskId !== taskId) continue
      const note = await store.read(location, summary.slug).catch(() => null)
      if (!note) unreadable.push(summary.title)
      // An untouched scratchpad would add only a heading.
      else if (note.body.trim()) notes.push({ location, note })
    }
  }
  return { notes, locations, unreadable }
}
