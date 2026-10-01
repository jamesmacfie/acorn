// The client's notes surface (docs/notes-and-memory.md), backed by loopback HTTP to the
// node's NotesStore, so it 503s in dev:node. Note shapes are canonical in
// @acorn/protocol/notes.ts; re-exported here so existing feature imports keep working.
import { noteIncludedRoute, noteRoute, noteTitleRoute, notesListRoute } from '../shared/api'
import { activeNodeId, openPane, readJson, writeJson } from '@acorn/plugin-api/client'
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

// A factory captures custody once; null explicitly targets the serving origin.
export function notesApi(nodeId: string | null = activeNodeId()): NotesApi {
  const options = { nodeId }
  const post = <T>(url: string, body?: unknown) =>
    writeJson<T>(url, { ...options, method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return {
    list: (location) => readJson(notesListRoute(location), options),
    read: (location, slug) => readJson(noteRoute(location, slug), options),
    create: (location, title, kind) => post(notesListRoute(location), { title, kind }),
    write: (location, slug, body) => writeJson(noteRoute(location, slug), { ...options, method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) }),
    setIncluded: (location, slug, included) => post(noteIncludedRoute(location, slug), { included }),
    setTitle: (location, slug, title) => post(noteTitleRoute(location, slug), { title }),
    remove: (location, slug) => writeJson(noteRoute(location, slug), { ...options, method: 'DELETE' }),
  }
}

export const requestNoteOpen = (taskId: string, slug: string, scope: NoteScope = 'workspace') =>
  openPane(taskId, 'notes', { kind: 'notes:open', slug, scope })
