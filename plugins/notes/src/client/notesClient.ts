// The renderer's notes surface (docs/notes-and-memory.md), backed by loopback HTTP to the
// main-process NotesStore, so it 503s in dev:node. Note shapes are canonical in
// @acorn/protocol/notes.ts; re-exported here so existing feature imports keep working.
import { noteIncludedRoute, noteRoute, noteTitleRoute, notesListRoute } from '../shared/api'
import { openPane, readJson, writeJson } from '@acorn/plugin-api/client'
import type { Note, NoteKind, NoteLocation, NoteScope, NoteSummary } from '@acorn/protocol/notes.ts'
export type { Note, NoteAuthor, NoteKind, NoteLocation, NoteScope, NoteSummary } from '@acorn/protocol/notes.ts'

export type NotesApi = {
  list(location: NoteLocation): Promise<NoteSummary[] | { error: string }>
  read(location: NoteLocation, slug: string): Promise<Note | { error: string }>
  create(location: NoteLocation, title: string, kind?: NoteKind): Promise<{ slug: string } | { error: string }>
  write(location: NoteLocation, slug: string, body: string): Promise<{ ok: boolean } | { error: string }>
  setIncluded(location: NoteLocation, slug: string, included: boolean): Promise<{ ok: boolean } | { error: string }>
  setTitle(location: NoteLocation, slug: string, title: string): Promise<{ ok: boolean } | { error: string }>
  remove(location: NoteLocation, slug: string): Promise<{ ok: boolean } | { error: string }>
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const api: NotesApi = {
  list: (location) => readJson<NoteSummary[] | { error: string }>(notesListRoute(location)),
  read: (location, slug) => readJson<Note | { error: string }>(noteRoute(location, slug)),
  create: (location, title, kind) => post<{ slug: string } | { error: string }>(notesListRoute(location), { title, kind }),
  write: (location, slug, body) =>
    writeJson<{ ok: boolean } | { error: string }>(noteRoute(location, slug), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) }),
  setIncluded: (location, slug, included) => post<{ ok: boolean } | { error: string }>(noteIncludedRoute(location, slug), { included }),
  setTitle: (location, slug, title) => post<{ ok: boolean } | { error: string }>(noteTitleRoute(location, slug), { title }),
  remove: (location, slug) => writeJson<{ ok: boolean } | { error: string }>(noteRoute(location, slug), { method: 'DELETE' }),
}

export const notesApi = (): NotesApi => api

export const requestNoteOpen = (taskId: string, slug: string, scope: NoteScope = 'workspace') =>
  openPane(taskId, 'notes', { kind: 'notes:open', slug, scope })
