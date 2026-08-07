import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { Note, NoteAuthor, NoteKind, NoteLocation, NoteSummary } from '@acorn/protocol/notes.ts'

// Provenance a non-human writer stamps on a note it creates or replaces. `author: 'agent'` plus the
// agent's session id is what the pane's provenance badge and the context assembler's `origin` field
// read; `author: 'workflow'` is how a seeded PR snapshot and a run handoff are told apart from a note
// the owner typed.
export type NoteWriter = { author: NoteAuthor; originSessionId?: string; originTaskId?: string }

export type NoteCreateOptions = {
  author?: NoteAuthor
  kind?: NoteKind
  originSessionId?: string
  originTaskId?: string
  included?: boolean
  body?: string
}

// The eight methods the five consumers actually call, restated here so the signature belongs to the
// provider rather than being defined by NotesStore's class shape. `read` REJECTS on a missing note
// rather than resolving null — every caller already treats "no such note" as an exception path
// (`.catch(() => null)` where it is optional), and changing that here would silently swallow a
// traversal-rejected slug too.
export type NotesStoreCapability = {
  list(location: NoteLocation): Promise<NoteSummary[]>
  read(location: NoteLocation, slug: string): Promise<Note>
  create(location: NoteLocation, title: string, options?: NoteCreateOptions): Promise<{ slug: string }>
  write(location: NoteLocation, slug: string, body: string, writer?: NoteWriter): Promise<void>
  // Create-or-append, so an agent logging a finding does not have to check existence first.
  append(location: NoteLocation, slug: string, text: string, options?: NoteWriter): Promise<void>
  // Whether the note is fed to an agent as assembled context (the pane's select/deselect, and how a
  // finished run stops re-injecting its own handoffs).
  setIncluded(location: NoteLocation, slug: string, included: boolean): Promise<void>
  setTitle(location: NoteLocation, slug: string, title: string): Promise<void>
  remove(location: NoteLocation, slug: string): Promise<void>
}

export const NOTES_STORE = capabilityId<NotesStoreCapability>('notes.store')
