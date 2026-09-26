import type { Comment, PullCommit, PullDetail, Review, Thread } from '../../shared/api'

export function hasRenderableBody(body: string | null | undefined): boolean {
  if (!body) return false
  if (/<(img|pre|code|table|ul|ol|blockquote)\b/i.test(body)) return true
  return body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0
}

export function reviewAction(state: string | null): string {
  switch ((state ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'requested changes'
    case 'COMMENTED':
      return 'reviewed'
    case 'DISMISSED':
      return 'dismissed review'
    default:
      return state ? state.toLowerCase().replaceAll('_', ' ') : 'reviewed'
  }
}

export function shouldShowReviewSummary(review: Review): boolean {
  return hasRenderableBody(review.body) || (review.state ?? '').toUpperCase() !== 'COMMENTED'
}

export function byTime<T extends { createdAt: number | null }>(a: T, b: T): number {
  return (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER)
}

export const threadComments = (thread: Thread) => [...thread.comments].sort(byTime)
export function firstThreadComment(thread: Thread): Thread['comments'][number] | undefined {
  let first: Thread['comments'][number] | undefined
  for (const comment of thread.comments) if (!first || byTime(comment, first) < 0) first = comment
  return first
}
export const threadCreatedAt = (thread: Thread) => firstThreadComment(thread)?.createdAt ?? null

// `key` is the turn's identity in the conversation's Timeline: the kind and the provider's id, so a
// commit SHA, a review's node id and a comment's id can never collide. It survives a refetch, a body
// arriving and a sort tie, which is what lets a turn keep its element (docs/github-integration.md §
// Conversation).
export type ConversationEntry =
  | { kind: 'review'; id: string; key: string; createdAt: number | null; review: Review }
  | { kind: 'comment'; id: string; key: string; createdAt: number | null; comment: Comment }
  | { kind: 'commit'; id: string; key: string; createdAt: number | null; commit: PullCommit }
  | { kind: 'thread'; id: string; key: string; createdAt: number | null; thread: Thread }

type Unkeyed<T> = T extends unknown ? Omit<T, 'key'> : never

/**
 * Every turn of a pull request's conversation, oldest first. The sort is stable, so turns with the
 * same time keep the order they are listed in here. A provider id seen twice in one kind gets a
 * numbered key rather than a duplicate one, numbered by that same order, so the list never falls back
 * to keying by position.
 */
export function buildConversationEntries(data: PullDetail | undefined): ConversationEntry[] {
  if (!data) return []
  const entries: Unkeyed<ConversationEntry>[] = [
    ...data.reviews.filter(shouldShowReviewSummary).map((review) => ({ kind: 'review' as const, id: review.id, createdAt: review.submittedAt, review })),
    ...data.comments.map((comment) => ({ kind: 'comment' as const, id: comment.id, createdAt: comment.createdAt, comment })),
    ...data.commits.map((commit) => ({ kind: 'commit' as const, id: commit.sha, createdAt: commit.committedAt, commit })),
    ...data.threads.filter((thread) => thread.comments.length > 0).map((thread) => ({ kind: 'thread' as const, id: thread.threadId, createdAt: threadCreatedAt(thread), thread })),
  ]
  const seen = new Map<string, number>()
  const keyed = entries.map((entry) => {
    const base = `${entry.kind}:${entry.id}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return { ...entry, key: count === 1 ? base : `${base}#${count}` } as ConversationEntry
  })
  return keyed.sort((a, b) => (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER))
}
