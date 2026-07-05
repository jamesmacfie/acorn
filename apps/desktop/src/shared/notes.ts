// Canonical workspace-note shapes (docs/notes-and-memory.md), shared across the preload boundary:
// main/notes.ts (the store) and client/features/notes/notesClient.ts both import from here, so the
// two sides can't drift. Kinds are scratch|plan|finding|handoff ONLY — anchored annotations are
// review_notes rows (README decision 16), never note kinds.

export type NoteAuthor = 'user' | 'agent' | 'workflow'
export type NoteKind = 'scratch' | 'plan' | 'finding' | 'handoff'

export type NoteSummary = { slug: string; title: string; author: NoteAuthor; kind: NoteKind; updatedAt: number }

export type Note = {
  slug: string
  title: string
  author: NoteAuthor
  kind: NoteKind
  originSessionId: string | null // set when an agent/workflow wrote it (provenance)
  createdAt: number
  body: string
}
