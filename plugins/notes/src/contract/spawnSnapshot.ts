import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

/** The notes a delegated agent starts with, captured once for its first turn
 *  (docs/notes-and-memory.md § Notes in delegated agents). */
export type SpawnNotesSnapshot = {
  /** The text to attach to the child's first turn, or '' when there is nothing to attach. */
  content: string
  /** The notes the text holds. The caller stores this with the turn and passes it back as `inherited`
   *  when that child delegates in turn. Only the notes plugin reads its shape. */
  notes: unknown[]
  capturedAt: number
}

export type SpawnNotesCapture = (input: {
  /** The task the child works in. */
  taskId: string
  /** The task that delegated, when the child works in a different one. */
  parentTaskId?: string
  /** The `notes` of the delegating session's own snapshot, as stored. Anything unreadable is dropped. */
  inherited?: unknown
}) => Promise<SpawnNotesSnapshot>

export const NOTES_SPAWN_SNAPSHOT = capabilityId<SpawnNotesCapture>('notes.spawnSnapshot')
