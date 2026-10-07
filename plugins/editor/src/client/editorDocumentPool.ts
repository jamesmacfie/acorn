import { onCleanup } from 'solid-js'
import type { EditorState, Extension, Text } from '@codemirror/state'
import type { DocumentCustody } from '@acorn/plugin-api/ui/editor'
import type { EditorApi } from './editorClient'
import type { EditorReadResult } from '../contract/api'

export type PooledFile = {
  state: EditorState
  custody: DocumentCustody
  release: () => void
  language: Extension
  mount: object
  markersReadAt: number
  markersGeneration: number
  stale?: boolean
  disk?: EditorReadResult
}

export type EditorPool = {
  retired: boolean
  files: Map<string, PooledFile>
  saved: Map<string, Text>
  reading: Map<string, { mount: object; run: Promise<EditorState | null> }>
  externalEditors: Set<string>
}

export function flushEditorDocument(custody: DocumentCustody, api: EditorApi, taskId: string, path: string): Promise<void> {
  return custody.flush(async (text) => {
    const expected = custody.acknowledgedRevision
    if (!expected) throw new Error('The saved disk version is unknown. Reload or compare before saving.')
    const result = await api.write(taskId, path, text, expected)
    if (!result.ok) {
      if (result.kind === 'conflict' || result.kind === 'deleted') custody.writeBlock = result.reason
      throw new Error(result.reason)
    }
    return result
  })
}

/** The pane model holds open view states; dirty custody survives model retirement. */
export function createEditorDocumentPool(api: EditorApi, taskId: string): EditorPool {
  const pool: EditorPool = { retired: false, files: new Map(), saved: new Map(), reading: new Map(), externalEditors: new Set() }
  onCleanup(() => {
    pool.retired = true
    for (const [path, entry] of pool.files) {
      void flushEditorDocument(entry.custody, api, taskId, path).catch(() => {})
      entry.release()
    }
    pool.files.clear()
    pool.saved.clear()
    pool.reading.clear()
  })
  return pool
}

/** Phase 02 file actions join an admitted save and stop every follow-up path, including retirement. */
export async function suspendEditorFile(pool: EditorPool, path: string): Promise<() => void> {
  if (pool.externalEditors.has(path)) throw new Error('Close $EDITOR before changing this file.')
  const entry = pool.files.get(path)
  return entry ? entry.custody.suspendWrites() : () => {}
}

/** Called only after the Node confirms a rename. The next mount rebuilds path-bound extensions. */
export function rebindEditorFile(pool: EditorPool, oldPath: string, newPath: string, address: readonly (string | null)[]): void {
  const entry = pool.files.get(oldPath)
  if (!entry) return
  if (pool.files.has(newPath)) throw new Error('The destination document is already open.')
  entry.custody.rebind(address)
  pool.files.delete(oldPath)
  entry.mount = {}
  pool.files.set(newPath, entry)
  const saved = pool.saved.get(oldPath)
  pool.saved.delete(oldPath)
  if (saved) pool.saved.set(newPath, saved)
  pool.reading.delete(oldPath)
}

/** Called only after a confirmed delete; the custody retains dirty recovery after release. */
export function retireEditorFile(pool: EditorPool, path: string): void {
  const entry = pool.files.get(path)
  if (!entry) return
  pool.files.delete(path)
  pool.saved.delete(path)
  pool.reading.delete(path)
  entry.release()
}
