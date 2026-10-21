// Reads/writes files on the active task's worktree through the node's HTTP routes, so the editor works
// in a plain browser (dev:node) too.
import {
  editorFilesRoute,
  editorFileStatusRoute,
  editorImageRoute,
  editorListRoute,
  editorLineMarkersRoute,
  editorReadRoute,
  editorRootRoute,
  editorWriteRoute,
  editorEntryRoute,
  editorCreateRoute,
  editorRenameRoute,
  editorRenameAvailabilityRoute,
  editorTrashRoute,
  editorTrashAvailabilityRoute,
  type FileTarget,
  type FileActionResult,
  type TrashAvailability,
  type EditorEntry,
  type EditorReadResult,
  type EditorLineMarkerSnapshot,
  type EditorWriteResult,
} from '../contract/api'
import type { QueryClient } from '@tanstack/solid-query'
import { activeNodeId, queryOwner, readBytes, readJson, writeJson } from '@acorn/plugin-api/client'
import { MAX_IMAGE_PREVIEW_BYTES } from '../contract/imagePreview'
import type { EditorFileStatusSnapshot } from '../contract/fileStatus'

export type { EditorEntry } from '../contract/api'

export type EditorApi = {
  root(taskId: string): Promise<string | null>
  list(taskId: string, relPath: string): Promise<EditorEntry[]>
  files(taskId: string): Promise<string[]>
  fileStatus(taskId: string): Promise<EditorFileStatusSnapshot>
  read(taskId: string, relPath: string): Promise<EditorReadResult>
  readImage(taskId: string, relPath: string): Promise<{ bytes: Uint8Array; type: string }>
  lineMarkers(taskId: string, relPath: string, revision: string): Promise<EditorLineMarkerSnapshot | null>
  write(taskId: string, relPath: string, content: string, expectedRevision: string | null): Promise<EditorWriteResult>
  entry(taskId: string, path: string): Promise<FileTarget>
  trashAvailability(taskId: string): Promise<TrashAvailability>
  renameAvailability(taskId: string): Promise<TrashAvailability>
  create(taskId: string, parent: FileTarget, name: string, kind: 'file' | 'folder'): Promise<FileActionResult>
  rename(taskId: string, source: FileTarget, name: string): Promise<FileActionResult>
  trash(taskId: string, source: FileTarget): Promise<FileActionResult>
}

export const editorApi = (queryClient?: QueryClient): EditorApi => {
  const registered = queryClient ? queryOwner(queryClient) : undefined
  const nodeId = registered === undefined ? activeNodeId() : registered
  return editorApiForNode(nodeId)
}

/** Keep a command's request on the Node captured before the palette opened. */
export const editorApiForNode = (nodeId: string | null): EditorApi => ({
  root: (taskId) => readJson<{ root: string | null }>(editorRootRoute(taskId), { nodeId }).then((r) => r.root),
  list: (taskId, relPath) => readJson<EditorEntry[]>(editorListRoute(taskId, relPath), { nodeId }),
  files: (taskId) => readJson<string[]>(editorFilesRoute(taskId), { nodeId }),
  fileStatus: (taskId) => readJson<EditorFileStatusSnapshot>(editorFileStatusRoute(taskId), { nodeId }),
  read: (taskId, relPath) =>
    readJson<EditorReadResult>(editorReadRoute(taskId, relPath), { nodeId }).then((r) => {
      if (typeof r.revision !== 'string' || !/^[a-f0-9]{64}$/.test(r.revision))
        throw new Error('This Node does not support guarded document saves. Update the Node to edit this file.')
      return r
    }),
  readImage: (taskId, relPath) =>
    readBytes(editorImageRoute(taskId, relPath), 'Unable to read image.', {
      nodeId,
      maxResponseBytes: MAX_IMAGE_PREVIEW_BYTES,
    }),
  lineMarkers: async (taskId, relPath, revision) => {
    const result = await readJson<EditorLineMarkerSnapshot | unknown[]>(
      editorLineMarkersRoute(taskId, relPath, revision),
      { nodeId },
    )
    // An old Node ignores the added query parameter and returns an unverifiable array.
    // Mixed-version path until 2026-12-31.
    return !Array.isArray(result) && result.revision === revision ? result : null
  },
  entry: (taskId, path) => readJson<FileTarget>(editorEntryRoute(taskId, path), { nodeId }),
  trashAvailability: (taskId) => readJson<TrashAvailability>(editorTrashAvailabilityRoute(taskId), { nodeId }),
  renameAvailability: (taskId) => readJson<TrashAvailability>(editorRenameAvailabilityRoute(taskId), { nodeId }),
  create: (taskId, parent, name, kind) =>
    writeJson<FileActionResult>(editorCreateRoute(taskId), {
      method: 'POST',
      nodeId,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent, name, kind }),
    }),
  rename: (taskId, source, name) =>
    writeJson<FileActionResult>(editorRenameRoute(taskId), {
      method: 'POST',
      nodeId,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, name }),
    }),
  trash: (taskId, source) =>
    writeJson<FileActionResult>(editorTrashRoute(taskId), {
      method: 'POST',
      nodeId,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
  write: (taskId, relPath, content, expectedRevision) =>
    writeJson<EditorWriteResult>(editorWriteRoute(taskId), {
      method: 'PUT',
      nodeId,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: relPath, content, expectedRevision }),
    })
      .then((result): EditorWriteResult =>
        result.ok && (typeof result.text !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision))
          ? {
              ok: false,
              kind: 'failure',
              reason:
                'The Node did not acknowledge the saved text and revision. Update the Node before closing this document.',
            }
          : result,
      )
      .catch((cause: unknown) => {
        if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 400) {
          return {
            ok: false,
            kind: 'failure',
            reason: 'This Node does not support guarded document saves. Update the Node before closing this document.',
          }
        }
        throw cause
      }),
})

/** The task's checkout path, in the query cache so a hover can warm it and a remount can skip it. */
export const editorRootKey = (taskId: string): readonly unknown[] => ['editor', 'root', taskId]

/**
 * How long a known checkout path is trusted without asking again.
 *
 * A task's worktree path does not move underneath it — it is derived from the task and removed with
 * it — so the only transition this window can hide is "no checkout yet" becoming a path. The pane
 * never paints a cached *absent* root: it shows the cached value only when there is one, and awaits
 * the fetch otherwise (editorController.ts).
 */
export const EDITOR_ROOT_STALE_MS = 60_000

/** Warm the checkout path for a task the reader is pointing at. Best-effort, like every prefetch. */
export const prefetchEditorRoot = (queryClient: QueryClient, taskId: string): void => {
  const api = editorApi(queryClient)
  void queryClient
    .prefetchQuery({
      queryKey: editorRootKey(taskId),
      queryFn: () => api.root(taskId),
      staleTime: EDITOR_ROOT_STALE_MS,
    })
    .catch(() => {})
}
