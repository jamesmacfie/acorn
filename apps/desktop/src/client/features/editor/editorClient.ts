// Reads/writes files on the active task's worktree. Was the `window.acorn.editor` preload bridge;
// now loopback HTTP routes (Phase 3), so the editor works in a plain browser (dev:node) too. The
// accessor shape is unchanged so consumers keep their null-tolerant call sites; it just never
// returns null now that the surface is server-backed.
import { editorFilesRoute, editorListRoute, editorReadRoute, editorRootRoute, editorWriteRoute, type EditorEntry, type EditorWriteResult } from '../../../shared/api'
import { readJson, writeJson } from '../../apiClient'

export type { EditorEntry } from '../../../shared/api'

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
