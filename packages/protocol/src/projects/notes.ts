// Canonical note shapes (docs/notes-and-memory.md), shared across the process boundary:
// plugins/notes/src/server/notes.ts and plugins/notes/src/client/notesClient.ts both import from here,
// so the two sides can't drift. Kinds are scratch|plan|finding|handoff only; anchored annotations are
// review_notes rows (docs/notes-and-memory.md), never note kinds.

// The per-task scratchpad's reserved slug. A cross-surface contract (Notes pane lands here; the
// pane creates the file lazily on first keystroke), so it lives in protocol. No store changes: the
// empty-body context filter keeps an untouched scratchpad out of assembled context.
export const SCRATCHPAD_SLUG = 'scratchpad'

export type NoteAuthor = 'user' | 'agent' | 'workflow'
export type NoteKind = 'scratch' | 'plan' | 'finding' | 'handoff'
export type NoteScope = 'global' | 'workspace' | 'task'

// The words Notes and Context both show for a note's scope and author, here so the two panes say the
// same thing. Your own notes carry no author word.
export const NOTE_SCOPE_LABEL: Record<NoteScope, string> = { task: 'Task', workspace: 'Workspace', global: 'Everywhere' }
export const NOTE_AUTHOR_LABEL: Record<NoteAuthor, string> = { user: '', agent: 'By agent', workflow: 'From a workflow' }
export type NoteLocation =
  | { scope: 'global' }
  | { scope: 'workspace'; workspaceId: string }
  | { scope: 'task'; taskId: string }

export type NoteSummary = { slug: string; title: string; author: NoteAuthor; kind: NoteKind; included: boolean; originTaskId: string | null; updatedAt: number }

export type Note = {
  slug: string
  title: string
  author: NoteAuthor
  kind: NoteKind
  originSessionId: string | null // set when an agent/workflow wrote it (provenance)
  // Whether this note is fed to the agent as context (the Notes-pane select/deselect). Default true.
  included: boolean
  // The task that seeded this note (PR/comment/ticket notes). Auto-scopes context: a task's agent
  // only receives its own seeded notes. null for hand-written user/agent notes (shared workspace-wide).
  originTaskId: string | null
  createdAt: number
  body: string
}
