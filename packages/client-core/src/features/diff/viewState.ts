import { onScopeEvicted } from '../../host/registries/shell/scopeEviction'
import type { DiffReadingPlace } from './diffLayout'

// Session-only view position for a diff surface, so returning to one lands where you left it.
// A task's diff is a different scope from the same files opened outside a task, even when both show
// the same content; task-owned entries go when the task is archived.
//
// This is the diff viewer's own store rather than one of its callers': both the GitHub pull-request
// pane and the changes pane want the behaviour, and neither owns it.
export type DiffViewScope = {
  /** What is being diffed, in the caller's own vocabulary. Two scopes with the same key are one. */
  routeKey: string
  taskId?: string
}

/**
 * Where the reader was, by identity: an item of the document and a point in its code rows, or a
 * dynamic block and an offset into it (./diffLayout.ts). Not a pixel offset, which a thread measured
 * above the reader or a narrower pane would make wrong. Valid for the projection and the file set it
 * was taken in; a place whose item has gone lands on that file's header.
 */
export type DiffScrollState = {
  place: DiffReadingPlace
  /** Horizontal scroll, in pixels: code does not wrap, so nothing above the reader can move it. */
  left: number
  viewMode: 'unified' | 'split'
  filesSignature: string
}

/** Collapsed files, tied to the files signature they were collapsed against: new commits change the
    file set, and a collapse decision about the old diff does not carry over. */
export type DiffCollapsedFiles = {
  filesSignature: string
  paths: string[]
}

type DiffViewState = {
  scroll?: DiffScrollState
  collapsed?: DiffCollapsedFiles
}

const viewStates = new Map<string, DiffViewState>()

/** Exported so a caller keying its own session state by the same scope stays in step with this one,
    rather than writing a second spelling of the same key. */
export const diffScopeKey = (scope: DiffViewScope): string =>
  scope.taskId ? `task:${scope.taskId}:${scope.routeKey}` : `browse:${scope.routeKey}`

export const rememberDiffScroll = (scope: DiffViewScope, position: DiffScrollState): void => {
  const key = diffScopeKey(scope)
  viewStates.set(key, { ...viewStates.get(key), scroll: position })
}

export const diffScroll = (scope: DiffViewScope): DiffScrollState | undefined =>
  viewStates.get(diffScopeKey(scope))?.scroll

export const rememberDiffCollapsed = (scope: DiffViewScope, collapsed: DiffCollapsedFiles): void => {
  const key = diffScopeKey(scope)
  viewStates.set(key, { ...viewStates.get(key), collapsed })
}

export const diffCollapsed = (scope: DiffViewScope): DiffCollapsedFiles | undefined =>
  viewStates.get(diffScopeKey(scope))?.collapsed

export function evictDiffViewStates(taskId: string): void {
  const prefix = `task:${taskId}:`
  for (const key of viewStates.keys()) if (key.startsWith(prefix)) viewStates.delete(key)
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictDiffViewStates(e.taskId)
})
