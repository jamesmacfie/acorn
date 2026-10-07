import { activeNodeId } from '@acorn/plugin-api/client'
import { fileDocumentCustodies, recoverDocumentCustody, reserveDocumentDestinations, type DocumentCustody } from '@acorn/plugin-api/ui/editor'
import type { FileTarget, FileActionResult } from '../contract/api'
import type { EditorApi } from './editorClient'
import { flushEditorDocument, rebindEditorFile, suspendEditorFile, type EditorPool } from './editorDocumentPool'
import { editorMovePaths, editorOpen, editorRemovePaths, movedPath, openFiles, pathContains } from './editorState'
import { moveEditorTreeDirectories, removeEditorTreeDirectories } from './editorTreeState'
import { moveEditorViewStates, removeEditorViewStates } from './editorViewState'

export type ArmedFileAction = {
  target: FileTarget
  ready: Promise<void>
  release: () => void
  hold: () => () => void
  block: (reason: string) => void
  dirty: () => string[]
  custodies: Map<string, DocumentCustody>
  savedRevisions: Map<string, string | undefined>
}

export function createFileActionModel(api: EditorApi, pool: EditorPool, taskId: string, nodeId: string | null, beforeMutation: () => void) {
  const live = () => !pool.retired && activeNodeId() === nodeId
  const address = (path: string) => [nodeId, 'file', taskId, path] as const
  const affected = (path: string) => [...new Set([...pool.files.keys(), ...pool.saved.keys(), ...pool.reading.keys(), ...openFiles(taskId).map((file) => file.path), ...fileDocumentCustodies(nodeId, taskId, path).keys()])]
    .filter((file) => pathContains(path, file)).sort()
  const ensureLive = () => { if (!live()) throw new Error('The Node or task changed. Open the menu again.') }
  const check = (result: FileActionResult, armed?: ArmedFileAction): string => {
    if (!result.ok) {
      if (result.partial) armed?.block(`The Node reported a partial file action. Find the entry at its actual path before resolving drafts. ${result.reason}`)
      throw new Error(result.partial ? `${result.reason} Refresh the tree before trying again.` : result.reason)
    }
    return result.path
  }
  const sameEntry = (captured: FileTarget, current: FileTarget) => {
    if (current.root !== captured.root || current.path !== captured.path || current.kind !== captured.kind || current.entryId !== captured.entryId) throw new Error('The tree entry changed. Refresh and try again.')
  }

  /** Called at pointer/key invocation, before a menu can move focus and trigger blur autosave. */
  const arm = (target: FileTarget): ArmedFileAction => {
    ensureLive()
    const paths = affected(target.path)
    if ([...pool.externalEditors].some((path) => pathContains(target.path, path))) throw new Error('Close $EDITOR before changing this entry.')
    let releases: Array<() => void> = []
    const custodies = fileDocumentCustodies(nodeId, taskId, target.path)
    for (const path of paths) {
      const custody = pool.files.get(path)?.custody ?? recoverDocumentCustody(address(path))
      if (custody) custodies.set(path, custody)
    }
    const savedRevisions = new Map([...custodies].map(([path, custody]) => [path, custody.savedRevision]))
    let uiReleased = false
    let operations = 0
    const unlock = () => {
      if (!uiReleased || operations) return
      for (const release of releases.reverse()) release()
      releases = []
    }
    const pending = [...custodies].map(([path, custody]) => pool.files.has(path)
      ? suspendEditorFile(pool, path) : custody.suspendWrites()) // all counters rise before awaiting an admitted write
    const ready = Promise.all(pending).then((held) => { releases = held; unlock() })
    return {
      target,
      custodies,
      savedRevisions,
      ready,
      release: () => { uiReleased = true; unlock() },
      hold: () => {
        operations++
        let ended = false
        return () => { if (ended) return; ended = true; operations--; unlock() }
      },
      block: (reason) => { for (const custody of custodies.values()) { custody.writeBlock = reason; custody.flushRecovery() } },
      dirty: () => [...custodies].filter(([, custody]) => custody.dirty).map(([path]) => path),
    }
  }

  const create = async (parent: FileTarget, name: string, kind: 'file' | 'folder'): Promise<string> => {
    ensureLive()
    const destination = parent.path ? `${parent.path}/${name}` : name
    if (pool.files.has(destination) || recoverDocumentCustody(address(destination))) {
      throw new Error('The destination has an open or recovered draft.')
    }
    const unreserve = reserveDocumentDestinations([{ address: address(destination) }])
    try {
      const path = check(await api.create(taskId, parent, name, kind))
      if (live() && kind === 'file') editorOpen(taskId, path, false)
      return path
    } finally { unreserve() }
  }

  const rename = async (armed: ArmedFileAction, name: string): Promise<string> => {
    await armed.ready
    ensureLive()
    const from = armed.target.path
    const to = from.includes('/') ? `${from.slice(0, from.lastIndexOf('/'))}/${name}` : name
    const paths = new Set([from, ...affected(from), ...armed.custodies.keys()])
    const unreserve = reserveDocumentDestinations([...paths].filter((path) => movedPath(path, from, to) !== path)
      .map((path) => ({ address: address(movedPath(path, from, to)), custody: armed.custodies.get(path) })))
    let mutated = false
    try {
      const admittedSave = [...armed.custodies].some(([path, custody]) => custody.savedRevision !== armed.savedRevisions.get(path))
      const target = admittedSave ? await api.entry(taskId, from) : armed.target
      sameEntry(armed.target, target)
      const result = check(await api.rename(taskId, target, name), armed)
      mutated = true
      if (live()) beforeMutation()
      for (const [path, custody] of armed.custodies) {
        const destination = movedPath(path, from, result)
        if (destination === path) continue
        if (pool.files.get(path)?.custody === custody) rebindEditorFile(pool, path, destination, address(destination))
        else custody.rebind(address(destination))
      }
      if (activeNodeId() === nodeId) {
        editorMovePaths(taskId, from, result)
        moveEditorViewStates(taskId, from, result, nodeId)
        moveEditorTreeDirectories(taskId, from, result)
      }
      return result
    } catch (cause) {
      if (mutated) {
        const message = `The entry moved on the Node, but local recovery could not finish. Reopen the task and resolve the draft at its actual path. ${cause instanceof Error ? cause.message : String(cause)}`
        armed.block(message)
        throw new Error(message)
      }
      throw cause
    } finally { unreserve() }
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
    sameEntry(armed.target, target)
    if (armed.dirty().length) throw new Error('A draft changed during confirmation. Review it before moving to trash.')
    let mutated = false
    try {
      check(await api.trash(taskId, target), armed)
      mutated = true
      if (live()) beforeMutation()
      for (const [path, custody] of armed.custodies) {
        custody.retireFile()
        const entry = pool.files.get(path)
        if (entry?.custody === custody) {
          pool.files.delete(path)
          pool.saved.delete(path)
          pool.reading.delete(path)
          entry.release()
        }
      }
      if (activeNodeId() === nodeId) {
        editorRemovePaths(taskId, target.path)
        removeEditorViewStates(taskId, target.path, nodeId)
        removeEditorTreeDirectories(taskId, target.path)
      }
    } catch (cause) {
      if (mutated) {
        const message = `The entry moved to trash, but local recovery could not finish. Reopen the task and resolve the draft at its actual path. ${cause instanceof Error ? cause.message : String(cause)}`
        armed.block(message)
        throw new Error(message)
      }
      throw cause
    }
  }

  return { arm, create, rename, trash }
}
