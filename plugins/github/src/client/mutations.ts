// PR write actions. Routed through the broker, which attaches the device bearer in Electron main; no
// cookie and therefore no CSRF check (server/index.ts explains why). Throws the
// structured error code on failure so callers can branch (e.g. merge_failed, reauth).
//
// GitHub verbs only. Workspace/repo-visibility writes live in core/client/workspaces/mutations.ts,
// task and review-note writes in core/client/tasks/mutations.ts, and prefs behind
// core/client/settings/savePref.ts — none of those are GitHub concepts.
import { postJson, writeJson } from '@acorn/plugin-api/client'
import { autoMergeRoute, createPullRoute, pullRoute, rerunFailedRoute, requestedReviewersRoute, resolveThreadRoute } from '../contract/api'

export const createPr = (o: string, r: string, input: { title: string; body: string; base: string; head: string; draft: boolean }) =>
  postJson<{ number: number }>(createPullRoute(o, r), input)

export const mergePr = (o: string, r: string, n: string, method: string) => postJson(pullRoute(o, r, n, 'merge'), { method })
export const enableAutoMerge = (o: string, r: string, n: string, method: string) => postJson(autoMergeRoute(o, r, n), { method })
export const disableAutoMerge = (o: string, r: string, n: string) => writeJson(autoMergeRoute(o, r, n), { method: 'DELETE' })
export const closePr = (o: string, r: string, n: string) => postJson(pullRoute(o, r, n, 'close'))
export const reopenPr = (o: string, r: string, n: string) => postJson(pullRoute(o, r, n, 'reopen'))
export const setDraft = (o: string, r: string, n: string, draft: boolean) => postJson(pullRoute(o, r, n, 'draft'), { draft })
export const addComment = (o: string, r: string, n: string, body: string) => postJson<{ id: string }>(pullRoute(o, r, n, 'comments'), { body })
export const submitReview = (o: string, r: string, n: string, event: string, body: string) =>
  postJson(pullRoute(o, r, n, 'reviews'), { event, body })

export const addLabel = (o: string, r: string, n: string, name: string) => postJson(pullRoute(o, r, n, 'labels'), { name })
export const removeLabel = (o: string, r: string, n: string, name: string) =>
  writeJson(pullRoute(o, r, n, 'labels'), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })

export const requestReviewer = (o: string, r: string, n: string, login: string) =>
  postJson(requestedReviewersRoute(o, r, n), { login })
export const removeReviewer = (o: string, r: string, n: string, login: string) =>
  writeJson(requestedReviewersRoute(o, r, n), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login }),
  })

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
