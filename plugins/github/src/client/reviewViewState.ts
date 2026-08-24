import { onScopeEvicted } from '@acorn/plugin-api/client'
// Session-only scroll state for PR review surfaces. A task review is isolated from the classic
// GitHub browser even when both show the same PR; task-owned entries are evicted on archive.
export type ReviewViewScope = {
  routeKey: string
  taskId?: string
}

export type ReviewScrollPosition = {
  top: number
  left: number
}

export type ReviewDiffScrollPosition = ReviewScrollPosition & {
  viewMode: 'unified' | 'split'
  filesSignature: string
}

/** Collapsed diff files, tied to the files signature they were collapsed against: a force-push or
    new commit changes the file set, so stale paths are dropped rather than restored. */
export type ReviewDiffCollapsedFiles = {
  filesSignature: string
  paths: string[]
}

type ReviewViewState = {
  navigator?: ReviewScrollPosition
  diff?: ReviewDiffScrollPosition
  diffCollapsed?: ReviewDiffCollapsedFiles
}

const viewStates = new Map<string, ReviewViewState>()

const scopeKey = (scope: ReviewViewScope): string =>
  scope.taskId ? `task:${scope.taskId}:${scope.routeKey}` : `browse:${scope.routeKey}`

export const rememberReviewNavigatorScroll = (scope: ReviewViewScope, position: ReviewScrollPosition): void => {
  const key = scopeKey(scope)
  viewStates.set(key, { ...viewStates.get(key), navigator: position })
}

export const reviewNavigatorScroll = (scope: ReviewViewScope): ReviewScrollPosition | undefined =>
  viewStates.get(scopeKey(scope))?.navigator

export const rememberReviewDiffScroll = (scope: ReviewViewScope, position: ReviewDiffScrollPosition): void => {
  const key = scopeKey(scope)
  viewStates.set(key, { ...viewStates.get(key), diff: position })
}

export const reviewDiffScroll = (scope: ReviewViewScope): ReviewDiffScrollPosition | undefined =>
  viewStates.get(scopeKey(scope))?.diff

export const rememberReviewDiffCollapsed = (scope: ReviewViewScope, collapsed: ReviewDiffCollapsedFiles): void => {
  const key = scopeKey(scope)
  viewStates.set(key, { ...viewStates.get(key), diffCollapsed: collapsed })
}

export const reviewDiffCollapsed = (scope: ReviewViewScope): ReviewDiffCollapsedFiles | undefined =>
  viewStates.get(scopeKey(scope))?.diffCollapsed

export function evictReviewViewStates(taskId: string): void {
  const prefix = `task:${taskId}:`
  for (const key of viewStates.keys()) if (key.startsWith(prefix)) viewStates.delete(key)
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictReviewViewStates(e.taskId)
})
