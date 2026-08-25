import { diffScopeKey, type DiffViewScope } from '@acorn/plugin-api/ui/diff'
import { onScopeEvicted } from '@acorn/plugin-api/client'

// Session-only scroll state for the pull-request navigator, the summary column PullDetail renders.
// The diff column's own position and collapsed files are the diff viewer's to keep, in client-core's
// diff/viewState.ts, because the changes pane wants the same behaviour. Both stores key by the
// same scope, so a task's review is isolated from the classic GitHub browser even when both show the
// same pull request, and task-owned entries are evicted on archive.
export type { DiffViewScope as ReviewViewScope } from '@acorn/plugin-api/ui/diff'

export type ReviewScrollPosition = {
  top: number
  left: number
}

const navigatorScrolls = new Map<string, ReviewScrollPosition>()

export const rememberReviewNavigatorScroll = (scope: DiffViewScope, position: ReviewScrollPosition): void => {
  navigatorScrolls.set(diffScopeKey(scope), position)
}

export const reviewNavigatorScroll = (scope: DiffViewScope): ReviewScrollPosition | undefined =>
  navigatorScrolls.get(diffScopeKey(scope))

export function evictReviewViewStates(taskId: string): void {
  const prefix = `task:${taskId}:`
  for (const key of navigatorScrolls.keys()) if (key.startsWith(prefix)) navigatorScrolls.delete(key)
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictReviewViewStates(e.taskId)
})
