// Reads/writes files on the active task's worktree. Was the `window.acorn.editor` preload bridge;
// now loopback HTTP routes, so the editor works in a plain browser (dev:node) too. The
// accessor shape is unchanged so consumers keep their null-tolerant call sites; it just never
// returns null now that the surface is server-backed.
import {
  editorFilesRoute,
  editorListRoute,
  editorReadRoute,
  editorRootRoute,
  editorWriteRoute,
  type EditorEntry,
  type EditorWriteResult,
} from '../contract/api'
import type { QueryClient } from '@tanstack/solid-query'
import { readJson, writeJson } from '@acorn/plugin-api/client'

export type { EditorEntry } from '../contract/api'

export type EditorApi = {
  root(taskId: string): Promise<string | null>
  list(taskId: string, relPath: string): Promise<EditorEntry[]>
  files(taskId: string): Promise<string[]>
  read(taskId: string, relPath: string): Promise<string>
  write(taskId: string, relPath: string, content: string): Promise<EditorWriteResult>
}

const api: EditorApi = {
  root: (taskId) => readJson<{ root: string | null }>(editorRootRoute(taskId)).then((r) => r.root),
  list: (taskId, relPath) => readJson<EditorEntry[]>(editorListRoute(taskId, relPath)),
  files: (taskId) => readJson<string[]>(editorFilesRoute(taskId)),
  read: (taskId, relPath) => readJson<{ text: string }>(editorReadRoute(taskId, relPath)).then((r) => r.text),
  write: (taskId, relPath, content) =>
    writeJson<EditorWriteResult>(editorWriteRoute(taskId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: relPath, content }),
    }),
}

export const editorApi = (): EditorApi => api

/** The task's checkout path, in the query cache so a hover can warm it and a remount can skip it. */
export const editorRootKey = (taskId: string): readonly unknown[] => ['editor', 'root', taskId]

/**
 * How long a known checkout path is trusted without asking again.
 *
 * A task's worktree path does not move underneath it — it is derived from the task and removed with
 * it — so the only transition this window can hide is "no checkout yet" becoming a path. The pane
 * never paints a cached *absent* root: it shows the cached value only when there is one, and awaits
 * the fetch otherwise (EditorPane.tsx).
 */
export const EDITOR_ROOT_STALE_MS = 60_000

/** Warm the checkout path for a task the reader is pointing at. Best-effort, like every prefetch. */
export const prefetchEditorRoot = (queryClient: QueryClient, taskId: string): void => {
  void queryClient.prefetchQuery({
    queryKey: editorRootKey(taskId),
    queryFn: () => api.root(taskId),
    staleTime: EDITOR_ROOT_STALE_MS,
  }).catch(() => {})
}
