import { onCleanup } from 'solid-js'
import type { EditorState, Extension, Text } from '@codemirror/state'
import type { DocumentCustody } from '@acorn/plugin-api/ui/editor'
import type { EditorApi } from './editorClient'

export type PooledFile = {
  state: EditorState
  custody: DocumentCustody
  release: () => void
  language: Extension
  mount: object
  markersReadAt: number
  markersGeneration: number
}

export type EditorPool = {
  retired: boolean
  files: Map<string, PooledFile>
  saved: Map<string, Text>
  reading: Map<string, { mount: object; run: Promise<EditorState | null> }>
}

export function flushEditorDocument(custody: DocumentCustody, api: EditorApi, taskId: string, path: string): Promise<void> {
  return custody.flush(async (text) => {
    const result = await api.write(taskId, path, text)
    if (!result.ok) throw new Error(result.reason ?? 'Save failed')
    return result
  })
}

/** The pane model holds open view states; dirty custody survives model retirement. */
export function createEditorDocumentPool(api: EditorApi, taskId: string): EditorPool {
  const pool: EditorPool = { retired: false, files: new Map(), saved: new Map(), reading: new Map() }
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
