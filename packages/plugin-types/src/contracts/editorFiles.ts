/** Read one file of a task's worktree, for a plugin that draws it in the editor's `editor:document`
 *  point (docs/editor/file-renderers.md).
 *
 * Written out rather than `HostOwned`, like `agents.draftAttachments`, so a plugin outside this
 * repository can use the result without a cast. */
export type EditorFilesCapability = {
  /** Disk bytes, never the editor's unsaved buffer. `missing` covers no worktree, a path outside it,
   *  a directory, and no such file. Files over 12 MiB, the binary bridge's cap, are `too_large`. */
  read(input: {
    taskId: string
    path: string
  }): Promise<
    | { status: 'ok'; bytes: Uint8Array; revision: string }
    | { status: 'missing' }
    | { status: 'too_large'; byteSize: number }
  >
}
