import type { WorkflowDef } from './workflowContracts'
import type { WorkflowMergeConflict } from './workflowMerge'

export type WorkflowFileTarget = { projectId: string; source: 'repo' | 'user'; path: string }
export type WorkflowFileDraft = WorkflowFileTarget & {
  id: string
  revision: number
  baseText: string
  baseHash: string
  def: WorkflowDef
}
export type WorkflowFileWrite = { path: string; expectedHash: string | null; text: string; landed: boolean }
export type WorkflowFileOperation = {
  id: string
  projectId: string
  source: 'repo' | 'user'
  rootPath: string
  root: string
  rootId?: string
  draftId?: string
  draftRevision?: number
  state: 'prepared' | 'publishing' | 'complete' | 'needs-reconciliation'
  writes: WorkflowFileWrite[]
  reused: { path: string; hash: string }[]
  setup: string[]
  error?: string
}
export type WorkflowFileRequest =
  | { action: 'open'; target: WorkflowFileTarget }
  | { action: 'save'; target: WorkflowFileTarget; revision: number; def: WorkflowDef }
  | { action: 'review'; target: WorkflowFileTarget; revision: number; externalHash?: string; choices?: Record<string, 'local' | 'external'> }
  | { action: 'export'; projectId: string; id: string }
  | { action: 'publish'; id: string }
  | { action: 'discard'; id: string }
  | { action: 'list'; projectId: string }
export type WorkflowFileResult = {
  draft?: WorkflowFileDraft
  operation?: WorkflowFileOperation
  operations?: WorkflowFileOperation[]
  conflicts?: WorkflowMergeConflict[]
  externalHash?: string
}
