import { createSignal } from 'solid-js'

// The renderer's notes surface (docs/notes-and-memory.md). Was the `window.acorn.notes` preload bridge;
// now loopback HTTP (Phase 3). Backed by the main-process NotesStore, so it 503s in dev:node. Note
// shapes are canonical in shared/notes.ts (main's NotesStore imports the same types) — re-exported
// here so existing feature imports keep working.
import { noteIncludedRoute, noteRoute, notesListRoute } from '../../../shared/api'
import { readJson, writeJson } from '../../apiClient'
import type { Note, NoteAuthor, NoteKind, NoteSummary } from '../../../shared/notes'
export type { Note, NoteAuthor, NoteKind, NoteSummary } from '../../../shared/notes'

// Notes are scoped either to the current workspace or GLOBAL (shared across every workspace). The
// store keys by an opaque id; global notes live under this reserved key. Workspace ids are uuids,
// so 'global' can never collide with a real one. No store change — just a well-known key.
export type NoteScope = 'workspace' | 'global'
export const GLOBAL_NOTES_ID = 'global'

export type NotesApi = {
  list(workspaceId: string): Promise<NoteSummary[] | { error: string }>
  read(workspaceId: string, slug: string): Promise<Note | { error: string }>
  create(workspaceId: string, title: string, kind?: NoteKind): Promise<{ slug: string } | { error: string }>
  write(workspaceId: string, slug: string, body: string): Promise<{ ok: boolean } | { error: string }>
  setIncluded(workspaceId: string, slug: string, included: boolean): Promise<{ ok: boolean } | { error: string }>
  remove(workspaceId: string, slug: string): Promise<{ ok: boolean } | { error: string }>
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const api: NotesApi = {
  list: (workspaceId) => readJson<NoteSummary[] | { error: string }>(notesListRoute(workspaceId)),
  read: (workspaceId, slug) => readJson<Note | { error: string }>(noteRoute(workspaceId, slug)),
  create: (workspaceId, title, kind) => post<{ slug: string } | { error: string }>(notesListRoute(workspaceId), { title, kind }),
  write: (workspaceId, slug, body) =>
    writeJson<{ ok: boolean } | { error: string }>(noteRoute(workspaceId, slug), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) }),
  setIncluded: (workspaceId, slug, included) => post<{ ok: boolean } | { error: string }>(noteIncludedRoute(workspaceId, slug), { included }),
  remove: (workspaceId, slug) => writeJson<{ ok: boolean } | { error: string }>(noteRoute(workspaceId, slug), { method: 'DELETE' }),
}

export const notesApi = (): NotesApi => api

// Cross-pane request (docs/next 11 §E): the Context pane's per-note "Edit" opens the Notes pane and
// asks it to load that slug in editable state. NotesPane consumes the signal on mount/change, clears it.
const [noteToOpen, setNoteToOpen] = createSignal<string | null>(null)
export { noteToOpen }
export const requestNoteOpen = (slug: string) => setNoteToOpen(slug)
export const clearNoteOpen = () => setNoteToOpen(null)
