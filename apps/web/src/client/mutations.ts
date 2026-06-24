// PR write actions. Same-origin POST (cookie auth; the Worker's csrf() checks Origin). Throws the
// structured error code on failure so callers can branch (e.g. merge_failed, reauth).
import { apiError, writeJson } from './apiClient'
import {
  createPullRoute,
  pinsRoute,
  prefsRoute,
  pullRoute,
  rerunFailedRoute,
  resolveThreadRoute,
} from '../shared/api'

const post = async <T>(url: string, body?: unknown): Promise<T> => {
  return writeJson<T>(url, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const createPr = (o: string, r: string, input: { title: string; body: string; base: string; head: string; draft: boolean }) =>
  post<{ number: number }>(createPullRoute(o, r), input)

export const mergePr = (o: string, r: string, n: string, method: string) => post(pullRoute(o, r, n, 'merge'), { method })
export const closePr = (o: string, r: string, n: string) => post(pullRoute(o, r, n, 'close'))
export const reopenPr = (o: string, r: string, n: string) => post(pullRoute(o, r, n, 'reopen'))
export const setDraft = (o: string, r: string, n: string, draft: boolean) => post(pullRoute(o, r, n, 'draft'), { draft })
export const addComment = (o: string, r: string, n: string, body: string) => post<{ id: string }>(pullRoute(o, r, n, 'comments'), { body })

export const addLabel = (o: string, r: string, n: string, name: string) => post(pullRoute(o, r, n, 'labels'), { name })
export const removeLabel = async (o: string, r: string, n: string, name: string) => {
  const res = await fetch(pullRoute(o, r, n, 'labels'), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(await apiError(res, `${res.status}`))
  return res.json()
}

// Inline review threads.
export const addReviewComment = (o: string, r: string, n: string, body: string, path: string, line: number, side: string) =>
  post(pullRoute(o, r, n, 'review-comments'), { body, path, line, side })
export const replyReview = (o: string, r: string, n: string, commentDatabaseId: number, body: string) =>
  post(pullRoute(o, r, n, `review-comments/${commentDatabaseId}/replies`), { body })
export const resolveThread = (o: string, r: string, n: string, threadId: string, resolved: boolean) =>
  post(resolveThreadRoute(o, r, n, threadId), { resolved })

export const setViewed = (o: string, r: string, n: string, path: string, viewed: boolean) =>
  post(pullRoute(o, r, n, 'viewed'), { path, viewed })

// Rerun a check's failed Actions jobs. Repo-scoped (keyed by the workflow run id, not the PR).
export const rerunFailed = (o: string, r: string, runId: number) => post(rerunFailedRoute(o, r, runId))

export const setPin = async (repoId: number, pinned: boolean) => {
  return writeJson<{ repoId: number; pinned: boolean }>(pinsRoute, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId, pinned }),
  }, (res) => `pins ${res.status}`)
}

export const setPref = async (key: string, value: string) => {
  return writeJson<{ key: string; value: string }>(prefsRoute, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }, (res) => `prefs ${res.status}`)
}
