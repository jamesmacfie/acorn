import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'

export type EditorFileChange = {
  path: string
  oldPath?: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
  staged: boolean
}

export type EditorFileStatusSnapshot =
  | { kind: 'ready'; changes: EditorFileChange[] }
  | { kind: 'not-git' }
  | { kind: 'unavailable' }

/** The owner receives a task address and its already resolved checkout, then verifies that address. */
export type EditorFileStatusProvider = {
  read(taskId: string, source: { root: string }): Promise<EditorFileStatusSnapshot>
}

export const EDITOR_FILE_STATUS = extensionPointId<EditorFileStatusProvider>('editor:file-status')
