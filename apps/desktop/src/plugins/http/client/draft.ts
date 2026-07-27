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

// An unsaved new request survives navigation (and a reload) in localStorage, the same per-device
// mechanism as GitHub comment drafts — leave the panel mid-request and it is still there. Only the
// *unsaved* one is kept: once it has a row, the row is the truth.
const storageKey = (owner: string, repo: string, taskId?: string): string => `http-draft:${owner}/${repo}:${taskId ?? 'repo'}`

export function readStoredDraft(owner: string, repo: string, taskId?: string): Draft | null {
  const raw = localStorage.getItem(storageKey(owner, repo, taskId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as Draft
  } catch {
    return null
  }
}

export function writeStoredDraft(owner: string, repo: string, taskId: string | undefined, draft: Draft | null): void {
  const key = storageKey(owner, repo, taskId)
  if (draft) localStorage.setItem(key, JSON.stringify(draft))
  else localStorage.removeItem(key)
}
