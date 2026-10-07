import { activeNodeId } from '@acorn/plugin-api/client'
import { recoverDocumentCustody, type DocumentCustody } from '@acorn/plugin-api/ui/editor'
import type { FileTarget, FileActionResult } from '../contract/api'
import type { EditorApi } from './editorClient'
import { assertCanRebindEditorFile, flushEditorDocument, rebindEditorFile, retireEditorFile, suspendEditorFile, type EditorPool } from './editorDocumentPool'
import { editorMovePaths, editorOpen, editorRemovePaths, movedPath, openFiles, pathContains } from './editorState'
import { moveEditorTreeDirectories, removeEditorTreeDirectories } from './editorTreeState'
import { moveEditorViewStates, removeEditorViewStates } from './editorViewState'

export type ArmedFileAction = {
  target: FileTarget
  ready: Promise<void>
  release: () => void
  dirty: () => string[]
  custodies: Map<string, DocumentCustody>
}

export function createFileActionModel(api: EditorApi, pool: EditorPool, taskId: string, nodeId: string | null, beforeMutation: () => void) {
  const live = () => !pool.retired && activeNodeId() === nodeId
  const affected = (path: string) => [...new Set([...pool.files.keys(), ...openFiles(taskId).map((file) => file.path)])]
    .filter((file) => pathContains(path, file)).sort()
  const ensureLive = () => { if (!live()) throw new Error('The Node or task changed. Open the menu again.') }
  const check = (result: FileActionResult): string => {
    if (!result.ok) throw new Error(result.partial ? `${result.reason} Refresh the tree before trying again.` : result.reason)
    return result.path
  }

  /** Called at pointer/key invocation, before a menu can move focus and trigger blur autosave. */
  const arm = (target: FileTarget): ArmedFileAction => {
    ensureLive()
    const paths = affected(target.path)
    if ([...pool.externalEditors].some((path) => pathContains(target.path, path))) throw new Error('Close $EDITOR before changing this entry.')
    const releases: Array<() => void> = []
    const custodies = new Map<string, DocumentCustody>()
    for (const path of paths) {
      const custody = pool.files.get(path)?.custody ?? recoverDocumentCustody([nodeId, 'file', taskId, path])
      if (custody) custodies.set(path, custody)
    }
    let released = false
    const pending = [...custodies].map(([path, custody]) => pool.files.has(path)
      ? suspendEditorFile(pool, path) : custody.suspendWrites()) // all counters rise before awaiting an admitted write
    const ready = Promise.all(pending).then((held) => {
      if (released) for (const release of held) release()
      else releases.push(...held)
    }).catch((cause: unknown) => {
      for (const release of releases.reverse()) release()
      throw cause
    })
    return {
      target,
      custodies,
      ready,
      release: () => { if (released) return; released = true; for (const release of releases.reverse()) release() },
      dirty: () => [...custodies].filter(([, custody]) => custody.dirty).map(([path]) => path),
    }
  }

  const create = async (parent: FileTarget, name: string, kind: 'file' | 'folder'): Promise<string> => {
    ensureLive()
    const destination = parent.path ? `${parent.path}/${name}` : name
    if (pool.files.has(destination) || recoverDocumentCustody([nodeId, 'file', taskId, destination])) {
      throw new Error('The destination has an open or recovered draft.')
    }
    const path = check(await api.create(taskId, parent, name, kind))
    ensureLive()
    if (kind === 'file') editorOpen(taskId, path, false)
    return path
  }

  const rename = async (armed: ArmedFileAction, name: string): Promise<string> => {
    await armed.ready
    ensureLive()
    const from = armed.target.path
    const to = from.includes('/') ? `${from.slice(0, from.lastIndexOf('/'))}/${name}` : name
    const paths = affected(from)
    for (const path of paths) {
      const destination = movedPath(path, from, to)
      const custody = armed.custodies.get(path)
      if (destination !== path && custody) {
        if (pool.files.has(path)) assertCanRebindEditorFile(pool, path, destination, [nodeId, 'file', taskId, destination])
        else custody.assertCanRebind([nodeId, 'file', taskId, destination])
      }
    }
    const result = check(await api.rename(taskId, armed.target, name))
    if (!live()) throw new Error('The entry was renamed on the previous Node. Reopen that task to refresh its tabs.')
    // A confirmed mutation owns the new path even if the pane switched while it was in flight.
    beforeMutation()
    for (const path of paths) {
      const destination = movedPath(path, from, result)
      if (destination !== path) {
        if (pool.files.has(path)) rebindEditorFile(pool, path, destination, [nodeId, 'file', taskId, destination])
        else armed.custodies.get(path)?.rebind([nodeId, 'file', taskId, destination])
      }
    }
    editorMovePaths(taskId, from, result)
    moveEditorViewStates(taskId, from, result, nodeId)
    moveEditorTreeDirectories(taskId, from, result)
    return result
  }

  const trash = async (armed: ArmedFileAction, saveDrafts: boolean): Promise<void> => {
    await armed.ready
    ensureLive()
    const dirty = armed.dirty()
    if (dirty.length && !saveDrafts) throw new Error('Unsaved drafts require Save and move to trash.')
    for (const path of dirty) {
      const custody = armed.custodies.get(path)
      if (custody) await flushEditorDocument(custody, api, taskId, path, true)
    }
    if (armed.dirty().length) throw new Error('A draft changed during saving. Review it before moving to trash.')
    // Explicit saves may update ctime. Re-read only after those guarded writes have succeeded.
    const target = dirty.length ? await api.entry(taskId, armed.target.path) : armed.target
    if (target.root !== armed.target.root || target.kind !== armed.target.kind) throw new Error('The tree entry changed. Refresh and try again.')
    check(await api.trash(taskId, target))
    if (!live()) throw new Error('The entry moved to the previous Node’s trash. Reopen that task to refresh its tabs.')
    beforeMutation()
    for (const path of affected(target.path)) retireEditorFile(pool, path)
    editorRemovePaths(taskId, target.path)
    removeEditorViewStates(taskId, target.path, nodeId)
    removeEditorTreeDirectories(taskId, target.path)
  }

  return { arm, create, rename, trash }
}
