import { postJson, writeJson } from '@acorn/plugin-api/client'
import {
  reviewNoteRoute,
  reviewNotesRoute,
  reviewNotesSentRoute,
  type ReviewNote,
  type ReviewNoteSeed,
} from '../../shared/changes/api'

// Task-scoped local review notes. They go to the task's agent, never to GitHub.
export const addReviewNote = (taskId: string, seed: ReviewNoteSeed) =>
  postJson<ReviewNote>(reviewNotesRoute(taskId), seed)
export const deleteReviewNote = (taskId: string, noteId: string) =>
  writeJson<{ ok: true }>(reviewNoteRoute(taskId, noteId), { method: 'DELETE' })
export const markReviewNotesSent = (taskId: string, ids: string[]) =>
  postJson<{ ok: true }>(reviewNotesSentRoute(taskId), { ids })
