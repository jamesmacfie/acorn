import type { EditorReadResult } from '../contract/api'
import type { PooledFile } from './editorDocumentPool'

export type FileDecision = {
  action: 'reload' | 'overwrite' | 'recreate' | 'save-as'
  nodeId: string | null
  taskId: string
  path: string
  destination: string
  entry: PooledFile
  editRevision: number
  disk: EditorReadResult | null
}

/** A confirmation names one document and one observed disk version, never the next active tab. */
export function captureFileDecision(
  action: FileDecision['action'],
  nodeId: string | null,
  taskId: string,
  path: string,
  entry: PooledFile,
  destination = path,
): FileDecision {
  return {
    action,
    nodeId,
    taskId,
    path,
    destination,
    entry,
    editRevision: entry.custody.revision,
    disk: entry.disk ? { ...entry.disk } : null,
  }
}

export function fileDecisionIsCurrent(
  decision: FileDecision,
  action: FileDecision['action'],
  nodeId: string | null,
  taskId: string,
  activePath: string | null,
  entry: PooledFile | undefined,
): boolean {
  if (!entry) return false
  return (
    decision.action === action &&
    decision.nodeId === nodeId &&
    decision.taskId === taskId &&
    decision.path === activePath &&
    decision.entry === entry &&
    decision.editRevision === entry.custody.revision &&
    decision.disk?.revision === entry.disk?.revision
  )
}

export type DiskReconciliation =
  | { kind: 'held'; status: 'unknown' | 'changed' | 'recovered' | null }
  | { kind: 'unchanged' | 'replace' }

/** Reconcile disk with one custody owner; the pane only applies a replacement to CodeMirror. */
export function reconcileEditorDisk(
  entry: PooledFile,
  disk: EditorReadResult,
  discardDraft: boolean,
): DiskReconciliation {
  const custody = entry.custody
  entry.disk = disk
  if (custody.dirty && !discardDraft) {
    if (!custody.acknowledgedRevision) {
      custody.writeBlock = 'The recovered draft has no known disk baseline.'
      return { kind: 'held', status: 'unknown' }
    }
    if (disk.revision !== custody.acknowledgedRevision) {
      custody.writeBlock = 'Changed on disk.'
      return { kind: 'held', status: 'changed' }
    }
    if (custody.requiresResolution) {
      custody.writeBlock = 'Recovered draft: confirm a save or reload from disk.'
      return { kind: 'held', status: 'recovered' }
    }
    custody.writeBlock = ''
    return { kind: 'held', status: null }
  }
  if (disk.text === custody.current.toString()) {
    if (custody.dirty || custody.requiresResolution) custody.reload(disk.text, disk.revision)
    else {
      custody.acknowledgedRevision = disk.revision
      custody.writeBlock = ''
    }
    return { kind: 'unchanged' }
  }
  custody.reload(disk.text, disk.revision)
  return { kind: 'replace' }
}

/** Worktree events carry no path. Read only the active file, at most once at a time. */
export function createEditorRefreshQueue(read: (path: string) => Promise<void>, delayMs = 40) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let requestedPath: string | null = null
  let reading = false
  let stopped = false
  const schedule = () => {
    if (stopped || reading || timer || !requestedPath) return
    timer = setTimeout(() => {
      timer = undefined
      void drain()
    }, delayMs)
  }
  const drain = async () => {
    const path = requestedPath
    requestedPath = null
    if (!path || stopped) return
    reading = true
    try {
      await read(path)
    } finally {
      reading = false
      schedule()
    }
  }
  return {
    request(path: string) {
      requestedPath = path
      schedule()
    },
    stop() {
      stopped = true
      requestedPath = null
      if (timer) clearTimeout(timer)
    },
  }
}
