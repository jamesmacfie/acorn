// The review-note writes, beside the routes they drive (../shared/api.ts). Core's task writes stay in
// @acorn/client-core/features/tasks/mutations.ts.
import { postJson, writeJson } from '@acorn/plugin-api/client'
import { reviewNoteRoute, reviewNotesRoute, reviewNotesSentRoute, type ReviewNote, type ReviewNoteSeed } from '../shared/api'

// Task-scoped local review notes; never sent to GitHub until the review is submitted.
export const addReviewNote = (taskId: string, seed: ReviewNoteSeed) => postJson<ReviewNote>(reviewNotesRoute(taskId), seed)
export const editReviewNote = (taskId: string, noteId: string, body: string) =>
  writeJson<{ ok: true }>(reviewNoteRoute(taskId, noteId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
export const deleteReviewNote = (taskId: string, noteId: string) =>
  writeJson<{ ok: true }>(reviewNoteRoute(taskId, noteId), { method: 'DELETE' })
export const markReviewNotesSent = (taskId: string, ids: string[]) => postJson<{ ok: true }>(reviewNotesSentRoute(taskId), { ids })
