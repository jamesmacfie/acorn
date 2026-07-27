// The editable shape of a request, shared by the panel and its tabs. It is the stored row minus the
// identity/ownership columns, which is also exactly the send payload — so an unsaved edit and an
// ad-hoc request that was never saved can both be fired without touching the DB first.
import type { HttpRequest } from '../shared/model'

export type Draft = Omit<HttpRequest, 'id' | 'repoOwner' | 'repoName' | 'createdAt' | 'updatedAt'>

export const emptyDraft = (taskId: string | null = null): Draft => ({
  folder: '',
  taskId,
  name: 'New request',
  method: 'GET',
  url: '',
  headers: [],
  bodyMode: 'none',
  body: '',
  auth: { mode: 'none' },
  vars: {},
})

export const toDraft = (row: HttpRequest): Draft => ({
  folder: row.folder,
  taskId: row.taskId,
  name: row.name,
  method: row.method,
  url: row.url,
  headers: row.headers,
  bodyMode: row.bodyMode,
  body: row.body,
  auth: row.auth,
  vars: row.vars,
})

// Structural comparison so the "unsaved changes" dot doesn't depend on key order or identity.
export const draftsDiffer = (a: Draft, b: Draft): boolean => JSON.stringify(a) !== JSON.stringify(b)
