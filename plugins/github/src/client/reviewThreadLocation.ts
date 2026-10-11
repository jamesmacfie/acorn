import type { PullDetail, PullDiffResponse, Thread } from '../shared/api'

/** Provider status is the authority for location; historical and unknown locations stay in history. */
export function reviewThreadLocation(thread: Thread): { path: string; side: 'old' | 'new'; line: number } | null {
  if (
    thread.outdated !== false ||
    !thread.path ||
    thread.line == null ||
    (thread.side !== 'LEFT' && thread.side !== 'RIGHT')
  )
    return null
  return { path: thread.path, side: thread.side === 'LEFT' ? 'old' : 'new', line: thread.line }
}

export function reviewRevisionsMatch(detail: PullDetail | undefined, diff: PullDiffResponse | undefined): boolean {
  return !!detail?.revision && detail.revision === diff?.revision
}

/** Only verified threads reach the generic viewer, including its layout reservations. */
export function inlineReviewThreads(detail: PullDetail | undefined, diff: PullDiffResponse | undefined): Thread[] {
  if (!reviewRevisionsMatch(detail, diff)) return []
  const paths = new Set(diff?.document.files.filter((file) => file.patchKey).map((file) => file.path))
  return (detail?.threads ?? []).filter((thread) => reviewThreadLocation(thread) && paths.has(thread.path!))
}
