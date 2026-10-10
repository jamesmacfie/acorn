import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import { MAX_PLUGIN_BYTES } from '@acorn/protocol/plugin/bridge.ts'

// editor.files: read one file of a task's worktree, for a plugin that draws it in the editor
// (docs/editor/file-renderers.md).
//
// A renderer can't call the editor's routes, and the editor's route capability includes `write`. This
// gives a renderer's node part the bytes and nothing else. The editor keeps the worktree and symlink
// confinement, and re-derives the worktree on every call, so a closed task or a moved worktree reads
// as missing.

export type EditorFileReadInput = { taskId: string; path: string }

export type EditorFileRead =
  | { status: 'ok'; bytes: Uint8Array; revision: string }
  /** No worktree, a path outside it, a directory, or no such file. One answer for all of them, so a
   *  caller learns nothing about what sits outside the worktree. */
  | { status: 'missing' }
  | { status: 'too_large'; byteSize: number }

/** The binary bridge's cap, so anything this returns fits through `bridge.api.getBytes`. */
export const MAX_EDITOR_FILE_READ_BYTES = MAX_PLUGIN_BYTES

export type EditorFilesCapability = {
  /**
   * The file's bytes on disk, with the SHA-256 revision the editor uses for the same content.
   *
   * Disk, not the editor's buffer: unsaved edits reach a renderer only through the `text` prop of
   * `editor:document`.
   */
  read(input: EditorFileReadInput): Promise<EditorFileRead>
}

export const EDITOR_FILES = capabilityId<EditorFilesCapability>('editor.files')
