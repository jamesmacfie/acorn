// Typed accessor for the preload's `window.acorn.notes` bridge (docs/next 09). The Window global
// is declared once in terminalClient.ts.
export type NoteAuthor = 'user' | 'agent' | 'workflow'
export type NoteKind = 'scratch' | 'plan' | 'finding' | 'handoff'
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
