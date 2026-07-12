// Canonical note shapes (docs/notes-and-memory.md), shared across the process boundary:
// main/notes.ts (the store) and client/features/notes/notesClient.ts both import from here, so the
// two sides can't drift. Kinds are scratch|plan|finding|handoff ONLY — anchored annotations are
// review_notes rows (README decision 16), never note kinds.

// The per-task scratchpad's reserved slug. A cross-surface contract (Notes pane lands here; the
// pane creates the file lazily on first keystroke), so it lives in shared. No store changes — the
// empty-body context filter keeps an untouched scratchpad out of assembled context.
export const SCRATCHPAD_SLUG = 'scratchpad'

export type NoteAuthor = 'user' | 'agent' | 'workflow'
export type NoteKind = 'scratch' | 'plan' | 'finding' | 'handoff'
export type NoteScope = 'global' | 'workspace' | 'task'
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
