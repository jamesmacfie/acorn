// notes.store — read and write the workspace/task/global note files this plugin owns
// (docs/vNext/plugins.md § Cross-plugin collaboration, which names this seam: "Memory → Notes store
// (knowledge bridge) | notes owns its storage; memory consumes `notes.read` capability").
//
// This file is the notes plugin's CONTRACT: the only surface another plugin may import. It carries the
// capability id and its signature, nothing executable — `NotesStore` itself stays in main/, and a
// contract may not name a plugin's internals (tools/arch/boundaries.test.ts).
//
// It exists because the store INSTANCE used to be constructed by plugins/memory's registerKnowledgeIpc
// and handed round as an app-layer dep. That was not laziness: notes was not a NodePlugin, so nothing
// owned the object, and every consumer — the notes pane, the four `notes_*` agent tools, core's context
// assembler, the workflow handoff writer, the task-note seeder — had to be given the SAME instance or
// two of them would race on the same files with independent atomic-write temp names. Now notes' init
// constructs it once and publishes it here, and "one store" is a property of the plugin rather than of
// the wiring order.
//
// Named `notes.store`, not plugins.md's `notes.read`: three of the five consumers WRITE (the pane
// creates and edits notes, the agent tools append, workflow handoffs append and then de-include), so a
// read-only signature would leave the write path exactly where it is today — in an app-layer dep bag.
// A separate read-only id over the same object would be two names for one seam.
//
// Consumers resolve it with `capabilities.get()`/`require()` at CALL time, not at init: plugin init
// order is undefined (server/plugin/capabilities.ts), so a consumer that caches at init may cache
// `undefined` purely because notes is declared after it in the plugin list.
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
