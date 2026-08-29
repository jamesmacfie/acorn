import { createResource } from 'solid-js'
import { readJson } from '@acorn/plugin-api/client'
import { editorFilesRoute } from '@acorn/plugin-editor/contract/api.ts'

/** The worktree's files, for the composer's `@` completions.
 *
 *  Its own module so the composer reads as one thing: the walk is a route on the editor plugin, and
 *  what the composer needs from it is three accessors. */
export function useWorktreeFiles(taskId: () => string) {
  const [files] = createResource(taskId, (id) => readJson<string[]>(editorFilesRoute(id)))
  return {
    paths: () => files() ?? [],
    loading: () => files.loading,
    error: () => files.error != null,
  }
}
