import type { ChangeRequestDetail, Thread } from './types'

/** The host's own status is the authority for a thread's location. An outdated thread, or one whose
 *  location the host never confirmed, stays in the conversation and off the diff. */
export function reviewThreadLocation(thread: Thread): { path: string; side: 'old' | 'new'; line: number } | null {
  if (thread.outdated !== false || !thread.path || thread.line == null || !thread.side) return null
  return { path: thread.path, side: thread.side, line: thread.line }
}

/** Whether the threads were read against the same revision as the diff on screen. */
export function reviewRevisionsMatch(
  detail: Pick<ChangeRequestDetail, 'revision'> | undefined,
  diff: { revision?: string | null } | undefined,
): boolean {
  return !!detail?.revision && detail.revision === diff?.revision
}

/** The threads the diff may place: verified against its revision, on a file it has a patch for, with
 *  each comment's avatar filled in. */
export function inlineReviewThreads(
  detail: ChangeRequestDetail | undefined,
  diff:
    | { revision?: string | null; document: { files: readonly { path: string; patchKey: string | null }[] } }
    | undefined,
  avatar: (login: string | null) => string | undefined,
): Thread[] {
  if (!reviewRevisionsMatch(detail, diff)) return []
  const paths = new Set(diff?.document.files.filter((file) => file.patchKey).map((file) => file.path))
  return (detail?.threads ?? [])
    .filter((thread) => reviewThreadLocation(thread) && paths.has(thread.path!))
    .map((thread) => ({
      ...thread,
      comments: thread.comments.map((comment) => ({
        ...comment,
        avatarUrl: comment.avatarUrl ?? avatar(comment.author),
      })),
    }))
}
