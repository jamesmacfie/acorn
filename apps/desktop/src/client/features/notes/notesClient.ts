import { createSignal } from 'solid-js'

// Typed accessor for the preload's `window.acorn.notes` bridge (docs/next 09). The Window global
// is declared once in terminalClient.ts.
export type NoteAuthor = 'user' | 'agent' | 'workflow'
export type NoteKind = 'scratch' | 'plan' | 'finding' | 'handoff'

// Notes are scoped either to the current workspace or GLOBAL (shared across every workspace). The
// store keys by an opaque id; global notes live under this reserved key. Workspace ids are uuids,
// so 'global' can never collide with a real one. No store change — just a well-known key.
export type NoteScope = 'workspace' | 'global'
export const GLOBAL_NOTES_ID = 'global'
export type NoteSummary = { slug: string; title: string; author: NoteAuthor; kind: NoteKind; updatedAt: number }
export type Note = { slug: string; title: string; author: NoteAuthor; kind: NoteKind; originSessionId: string | null; createdAt: number; body: string }

export type NotesApi = {
  list(workspaceId: string): Promise<NoteSummary[] | { error: string }>
  read(workspaceId: string, slug: string): Promise<Note | { error: string }>
  create(workspaceId: string, title: string, kind?: NoteKind): Promise<{ slug: string } | { error: string }>
  write(workspaceId: string, slug: string, body: string): Promise<{ ok: boolean } | { error: string }>
  remove(workspaceId: string, slug: string): Promise<{ ok: boolean } | { error: string }>
}

export const notesApi = (): NotesApi | null => window.acorn?.notes ?? null

// Cross-pane request (docs/next 11 §E): the Context pane's per-note "Edit" opens the Notes pane and
// asks it to load that slug in editable state. NotesPane consumes the signal on mount/change, clears it.
const [noteToOpen, setNoteToOpen] = createSignal<string | null>(null)
export { noteToOpen }
export const requestNoteOpen = (slug: string) => setNoteToOpen(slug)
export const clearNoteOpen = () => setNoteToOpen(null)
