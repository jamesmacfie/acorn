import { activeNodeId, clientEvents, onScopeEvicted } from '@acorn/plugin-api/client'
import { movedPath, pathContains } from './editorState'

export type EditorLocation = { path: string; line: number; column: number; scroll: number }
type ClosedTab = { path: string; index: number }
type Session = { closed: ClosedTab[]; history: EditorLocation[]; at: number }
const sessions = new Map<string, Session>()
const recents = new Map<string, string[]>()
const key = (nodeId: string | null, taskId: string) => JSON.stringify([nodeId, taskId])
const session = (nodeId: string | null, taskId: string): Session => {
  const id = key(nodeId, taskId)
  let value = sessions.get(id)
  if (!value) { value = { closed: [], history: [], at: -1 }; sessions.set(id, value) }
  return value
}

export function noteClosed(nodeId: string | null, taskId: string, tab: ClosedTab): void {
  const value = session(nodeId, taskId)
  value.closed.unshift(tab)
  value.closed.length = Math.min(value.closed.length, 20)
}
export function nextClosed(nodeId: string | null, taskId: string): ClosedTab | undefined {
  return session(nodeId, taskId).closed[0]
}
export function takeClosedIfCurrent(nodeId: string | null, taskId: string, tab: ClosedTab): boolean {
  const value = session(nodeId, taskId)
  if (value.closed[0] !== tab) return false
  value.closed.shift()
  return true
}

const same = (a: EditorLocation, b: EditorLocation) => a.path === b.path && a.line === b.line && a.column === b.column && a.scroll === b.scroll
/** Record the place left and the deliberate destination. A replay never calls this function. */
export function navigate(nodeId: string | null, taskId: string, from: EditorLocation | null, to: EditorLocation): void {
  const value = session(nodeId, taskId)
  if (value.at < value.history.length - 1) value.history.length = value.at + 1
  if (from && (value.at < 0 || !same(value.history[value.at], from))) value.history.push(from)
  if (!value.history.length || !same(value.history.at(-1)!, to)) value.history.push(to)
  if (value.history.length > 100) value.history.splice(0, value.history.length - 100)
  value.at = value.history.length - 1
}
export function historyStep(nodeId: string | null, taskId: string, direction: -1 | 1, current?: EditorLocation | null): EditorLocation | undefined {
  const value = session(nodeId, taskId)
  if (current && value.at >= 0 && value.history[value.at]?.path === current.path) value.history[value.at] = current
  const next = value.at + direction
  if (next < 0 || next >= value.history.length) return undefined
  value.at = next
  return value.history[next]
}
export function historyIsCurrent(nodeId: string | null, taskId: string, place: EditorLocation): boolean {
  const value = session(nodeId, taskId)
  return value.history[value.at] === place
}

const recentKey = (nodeId: string | null, taskId: string) => `acorn:editor:recent:v1:${encodeURIComponent(nodeId ?? '')}:${encodeURIComponent(taskId)}`
const storage = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
export function recentFiles(nodeId: string | null, taskId: string): string[] {
  const address = recentKey(nodeId, taskId)
  const cached = recents.get(address)
  if (cached) return cached
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(address) ?? '[]')
    const paths = Array.isArray(parsed) ? [...new Set(parsed.filter((path): path is string => typeof path === 'string' && !!path))].slice(0, 50) : []
    recents.set(address, paths)
    return paths
  } catch { recents.set(address, []); return [] }
}
export function noteActivated(nodeId: string | null, taskId: string, path: string): void {
  const next = [path, ...recentFiles(nodeId, taskId).filter((recent) => recent !== path)].slice(0, 50)
  recents.set(recentKey(nodeId, taskId), next)
  try { storage()?.setItem(recentKey(nodeId, taskId), JSON.stringify(next)) } catch { /* Device storage may be unavailable. */ }
}
export function pruneRecentToListing(nodeId: string | null, taskId: string, listed: readonly string[]): string[] {
  const valid = new Set(listed)
  const next = recentFiles(nodeId, taskId).filter((path) => valid.has(path))
  recents.set(recentKey(nodeId, taskId), next)
  try { storage()?.setItem(recentKey(nodeId, taskId), JSON.stringify(next)) } catch { /* Device storage may be unavailable. */ }
  return next
}
export function reconcileEditorMetadata(nodeId: string | null, taskId: string, from: string, to?: string): void {
  const value = sessions.get(key(nodeId, taskId))
  const transform = (path: string): string | null => !pathContains(from, path) ? path : to === undefined ? null : movedPath(path, from, to)
  if (value) {
    value.closed = value.closed.flatMap((tab) => { const path = transform(tab.path); return path ? [{ ...tab, path }] : [] })
    const beforeCursor = value.history.slice(0, value.at + 1).filter((place) => transform(place.path) !== null).length
    value.history = value.history.flatMap((place) => { const path = transform(place.path); return path ? [{ ...place, path }] : [] })
    value.at = Math.min(beforeCursor - 1, value.history.length - 1)
  }
  const address = recentKey(nodeId, taskId)
  let stored = false
  try { stored = !!storage()?.getItem(address) } catch { /* Device storage may be unavailable. */ }
  if (!value && !recents.has(address) && !stored) return
  const currentRecent = recentFiles(nodeId, taskId)
  const recent = currentRecent.flatMap((path) => transform(path) ?? [])
  const next = [...new Set(recent)].slice(0, 50)
  recents.set(recentKey(nodeId, taskId), next)
  try { storage()?.setItem(recentKey(nodeId, taskId), JSON.stringify(next)) } catch { /* Device storage may be unavailable. */ }
}
const evictTask = (nodeId: string | null, taskId: string) => {
  sessions.delete(key(nodeId, taskId))
  recents.delete(recentKey(nodeId, taskId))
  try { storage()?.removeItem(recentKey(nodeId, taskId)) } catch { /* Device storage may be unavailable. */ }
}
onScopeEvicted((event) => {
  if (event.scope !== 'task') return
  evictTask(activeNodeId(), event.taskId)
})
// The TUI has the same runtime archive event but no desktop scope-eviction adapter.
clientEvents.on('runtime:task-archived', ({ taskId }) => evictTask(activeNodeId(), taskId))
clientEvents.on('runtime:node-removed', ({ nodeId }) => {
  for (const address of sessions.keys()) if (JSON.parse(address)[0] === nodeId) sessions.delete(address)
  const prefix = `acorn:editor:recent:v1:${encodeURIComponent(nodeId)}:`
  for (const address of recents.keys()) if (address.startsWith(prefix)) recents.delete(address)
  try {
    const device = storage()
    if (device) for (let index = device.length - 1; index >= 0; index--) {
      const address = device.key(index)
      if (address?.startsWith(prefix)) device.removeItem(address)
    }
  } catch { /* Device storage may be unavailable. */ }
})
