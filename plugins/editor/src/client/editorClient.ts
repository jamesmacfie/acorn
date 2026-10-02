// Reads/writes files on the active task's worktree. Was the `window.acorn.editor` preload bridge;
// now loopback HTTP routes, so the editor works in a plain browser (dev:node) too. The
// accessor shape is unchanged so consumers keep their null-tolerant call sites; it just never
// returns null now that the surface is server-backed.
import {
  editorFilesRoute,
  editorImageRoute,
  editorListRoute,
  editorLineMarkersRoute,
  editorReadRoute,
  editorRootRoute,
  editorWriteRoute,
  type EditorEntry,
  type EditorLineMarkerSet,
  type EditorWriteResult,
} from '../contract/api'
import type { QueryClient } from '@tanstack/solid-query'
import { activeNodeId, queryOwner, readBytes, readJson, writeJson } from '@acorn/plugin-api/client'
import { MAX_IMAGE_PREVIEW_BYTES } from '../contract/imagePreview'

export type { EditorEntry } from '../contract/api'

export type EditorApi = {
  root(taskId: string): Promise<string | null>
  list(taskId: string, relPath: string): Promise<EditorEntry[]>
  files(taskId: string): Promise<string[]>
  read(taskId: string, relPath: string): Promise<string>
  readImage(taskId: string, relPath: string): Promise<{ bytes: Uint8Array; type: string }>
  lineMarkers(taskId: string, relPath: string): Promise<EditorLineMarkerSet[]>
  write(taskId: string, relPath: string, content: string): Promise<EditorWriteResult>
}

export const editorApi = (queryClient?: QueryClient): EditorApi => {
  const registered = queryClient ? queryOwner(queryClient) : undefined
  const nodeId = registered === undefined ? activeNodeId() : registered
  return {
  root: (taskId) => readJson<{ root: string | null }>(editorRootRoute(taskId), { nodeId }).then((r) => r.root),
  list: (taskId, relPath) => readJson<EditorEntry[]>(editorListRoute(taskId, relPath), { nodeId }),
  files: (taskId) => readJson<string[]>(editorFilesRoute(taskId), { nodeId }),
  read: (taskId, relPath) => readJson<{ text: string }>(editorReadRoute(taskId, relPath), { nodeId }).then((r) => r.text),
  readImage: (taskId, relPath) => readBytes(editorImageRoute(taskId, relPath), 'Unable to read image.', { nodeId, maxResponseBytes: MAX_IMAGE_PREVIEW_BYTES }),
  lineMarkers: (taskId, relPath) => readJson<EditorLineMarkerSet[]>(editorLineMarkersRoute(taskId, relPath), { nodeId }),
  write: (taskId, relPath, content) =>
    writeJson<EditorWriteResult>(editorWriteRoute(taskId), {
      method: 'PUT',
      nodeId,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: relPath, content }),
    }).then((result) => result.ok && typeof result.text !== 'string'
      ? { ok: false, reason: 'The Node did not acknowledge the saved text. Update the Node before closing this document.' }
      : result),
}
}

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
  const api = editorApi(queryClient)
  void queryClient.prefetchQuery({
    queryKey: editorRootKey(taskId),
    queryFn: () => api.root(taskId),
    staleTime: EDITOR_ROOT_STALE_MS,
  }).catch(() => {})
}
