import { createResource, createSignal } from 'solid-js'
import { readJson } from '@acorn/plugin-api/client'
import { editorFilesRoute } from '@acorn/plugin-editor/contract/api.ts'

/** The worktree's files, for the composer's `@` completions.
 *
 *  Its own module so the composer reads as one thing: the walk is a route on the editor plugin, and
 *  what the composer needs from it is a trigger and three accessors. Nothing is read until `want`
 *  is called, because the list runs to 145 KB on this repository and most visits to a task never
 *  type `@`. */
export function useWorktreeFiles(taskId: () => string) {
  const [wanted, setWanted] = createSignal(false)
  const [files] = createResource(
    () => (wanted() ? taskId() : undefined),
    (id) => readJson<string[]>(editorFilesRoute(id)),
  )
  return {
    want: () => setWanted(true),
    paths: () => files() ?? [],
    loading: () => files.loading,
    error: () => files.error != null,
  }
}
