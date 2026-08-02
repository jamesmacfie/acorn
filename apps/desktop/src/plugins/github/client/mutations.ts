// PR write actions. Same-origin POST (cookie auth; the server's csrf() checks Origin). Throws the
// structured error code on failure so callers can branch (e.g. merge_failed, reauth).
//
// GitHub verbs only. Workspace/repo-visibility writes live in core/client/workspaces/mutations.ts,
// task and review-note writes in core/client/tasks/mutations.ts, and prefs behind
// core/client/settings/savePref.ts — none of those are GitHub concepts.
import { ApiError, apiError, postJson } from '../../../core/client/apiClient'
import {
  autoMergeRoute,
  createPullRoute,
  pullRoute,
  rerunFailedRoute,
  requestedReviewersRoute,
  resolveThreadRoute,
} from '@acorn/protocol/api.ts'

export const createPr = (o: string, r: string, input: { title: string; body: string; base: string; head: string; draft: boolean }) =>
  postJson<{ number: number }>(createPullRoute(o, r), input)

export const mergePr = (o: string, r: string, n: string, method: string) => postJson(pullRoute(o, r, n, 'merge'), { method })
export const enableAutoMerge = (o: string, r: string, n: string, method: string) => postJson(autoMergeRoute(o, r, n), { method })
export const disableAutoMerge = async (o: string, r: string, n: string) => {
  const res = await fetch(autoMergeRoute(o, r, n), { method: 'DELETE' })
  if (!res.ok) throw new ApiError(await apiError(res, `${res.status}`), res.status)
  return res.json()
}
export const closePr = (o: string, r: string, n: string) => postJson(pullRoute(o, r, n, 'close'))
export const reopenPr = (o: string, r: string, n: string) => postJson(pullRoute(o, r, n, 'reopen'))
export const setDraft = (o: string, r: string, n: string, draft: boolean) => postJson(pullRoute(o, r, n, 'draft'), { draft })
export const addComment = (o: string, r: string, n: string, body: string) => postJson<{ id: string }>(pullRoute(o, r, n, 'comments'), { body })
export const submitReview = (o: string, r: string, n: string, event: string, body: string) =>
  postJson(pullRoute(o, r, n, 'reviews'), { event, body })

export const addLabel = (o: string, r: string, n: string, name: string) => postJson(pullRoute(o, r, n, 'labels'), { name })
export const removeLabel = async (o: string, r: string, n: string, name: string) => {
  const res = await fetch(pullRoute(o, r, n, 'labels'), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new ApiError(await apiError(res, `${res.status}`), res.status)
  return res.json()
}

export const requestReviewer = (o: string, r: string, n: string, login: string) =>
  postJson(requestedReviewersRoute(o, r, n), { login })
export const removeReviewer = async (o: string, r: string, n: string, login: string) => {
  const res = await fetch(requestedReviewersRoute(o, r, n), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login }),
  })
  if (!res.ok) throw new ApiError(await apiError(res, `${res.status}`), res.status)
  return res.json()
}

// Inline review threads.
export const addReviewComment = (o: string, r: string, n: string, body: string, path: string, line: number, side: string) =>
  postJson(pullRoute(o, r, n, 'review-comments'), { body, path, line, side })
export const replyReview = (o: string, r: string, n: string, commentDatabaseId: number, body: string) =>
  postJson(pullRoute(o, r, n, `review-comments/${commentDatabaseId}/replies`), { body })
export const resolveThread = (o: string, r: string, n: string, threadId: string, resolved: boolean) =>
  postJson(resolveThreadRoute(o, r, n, threadId), { resolved })

export const setViewed = (o: string, r: string, n: string, path: string, viewed: boolean) =>
  postJson(pullRoute(o, r, n, 'viewed'), { path, viewed })

// Rerun a check's failed Actions jobs. Repo-scoped (keyed by the workflow run id, not the PR).
export const rerunFailed = (o: string, r: string, runId: number) => postJson(rerunFailedRoute(o, r, runId))
