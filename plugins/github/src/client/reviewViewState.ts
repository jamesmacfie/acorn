import { onScopeEvicted } from '@acorn/client-core/registries/scopeEviction.ts'
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

type ReviewViewState = {
  navigator?: ReviewScrollPosition
  diff?: ReviewDiffScrollPosition
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

export function evictReviewViewStates(taskId: string): void {
  const prefix = `task:${taskId}:`
  for (const key of viewStates.keys()) if (key.startsWith(prefix)) viewStates.delete(key)
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictReviewViewStates(e.taskId)
})
