// PR write actions. Same-origin POST (cookie auth; the Worker's csrf() checks Origin). Throws the
// structured error code on failure so callers can branch (e.g. merge_failed, reauth).
import { apiError, writeJson } from './apiClient'
import { apiRoutes } from './queries'

const post = async <T>(url: string, body?: unknown): Promise<T> => {
  return writeJson<T>(url, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const mergePr = (o: string, r: string, n: string, method: string) => post(apiRoutes.merge(o, r, n), { method })
export const closePr = (o: string, r: string, n: string) => post(apiRoutes.close(o, r, n))
export const reopenPr = (o: string, r: string, n: string) => post(apiRoutes.reopen(o, r, n))
export const setDraft = (o: string, r: string, n: string, draft: boolean) => post(apiRoutes.draft(o, r, n), { draft })
export const addComment = (o: string, r: string, n: string, body: string) =>
  post<{ id: string }>(apiRoutes.comments(o, r, n), { body })

export const addLabel = (o: string, r: string, n: string, name: string) => post(apiRoutes.labels(o, r, n), { name })
export const removeLabel = async (o: string, r: string, n: string, name: string) => {
  const res = await fetch(apiRoutes.labels(o, r, n), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(await apiError(res, `${res.status}`))
  return res.json()
}

// Inline review threads.
export const addReviewComment = (o: string, r: string, n: string, body: string, path: string, line: number, side: string) =>
  post(apiRoutes.reviewComments(o, r, n), { body, path, line, side })
export const replyReview = (o: string, r: string, n: string, commentDatabaseId: number, body: string) =>
  post(apiRoutes.reviewReply(o, r, n, commentDatabaseId), { body })
export const resolveThread = (o: string, r: string, n: string, threadId: string, resolved: boolean) =>
  post(apiRoutes.resolveThread(o, r, n, threadId), { resolved })

export const setViewed = (o: string, r: string, n: string, path: string, viewed: boolean) =>
  post(apiRoutes.viewed(o, r, n), { path, viewed })

// Rerun a check's failed Actions jobs. Repo-scoped (keyed by the workflow run id, not the PR).
export const rerunFailed = (o: string, r: string, runId: number) => post(apiRoutes.rerunFailed(o, r, runId))

export const setPin = async (repoId: number, pinned: boolean) => {
  return writeJson<{ repoId: number; pinned: boolean }>(apiRoutes.pins, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId, pinned }),
  }, (res) => `pins ${res.status}`)
}

export const setPref = async (key: string, value: string) => {
  return writeJson<{ key: string; value: string }>(apiRoutes.prefs, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }, (res) => `prefs ${res.status}`)
}
