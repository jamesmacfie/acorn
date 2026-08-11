// The editable shape of a request, shared by the panel and its tabs. It is the stored row minus the
// identity columns. Storage ownership stays in `taskId`; send execution context is added explicitly
// by `toSendInput`, so opening a repo-saved row inside a task does not lose that task's worktree.
import type { HttpRequest, HttpSendInput } from '../shared/model'

export type Draft = Omit<HttpRequest, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>

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

export const toSendInput = (draft: Draft, executionTaskId: string | null): HttpSendInput => ({
  method: draft.method,
  url: draft.url,
  headers: draft.headers,
  bodyMode: draft.bodyMode,
  body: draft.body,
  auth: draft.auth,
  vars: draft.vars,
  executionTaskId,
})

// Structural comparison so the "unsaved changes" dot doesn't depend on key order or identity.
export const draftsDiffer = (a: Draft, b: Draft): boolean => JSON.stringify(a) !== JSON.stringify(b)
