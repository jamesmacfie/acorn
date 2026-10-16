import type { ChangeRequestDetail, Comment, Commit, Review, ReviewState, Thread } from './types'

export function hasRenderableBody(body: string | null | undefined): boolean {
  if (!body) return false
  if (/<(img|pre|code|table|ul|ol|blockquote)\b/i.test(body)) return true
  return (
    body
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim().length > 0
  )
}

const REVIEW_ACTIONS: Record<ReviewState, string> = {
  approved: 'approved',
  'changes-requested': 'requested changes',
  commented: 'reviewed',
  dismissed: 'dismissed review',
  pending: 'started a review',
}

export const reviewAction = (state: ReviewState | null): string => (state ? REVIEW_ACTIONS[state] : 'reviewed')

export type ReviewDecision = { state: 'changes-requested' | 'approved' | 'none'; reviewers: string[] }

/**
 * Where the reviews stand: each author's latest approval, change request or dismissal counts, and a
 * plain comment changes nothing. One change request outweighs any number of approvals. `reviewers`
 * names whoever holds the winning state.
 */
export function reviewDecision(reviews: readonly Review[]): ReviewDecision {
  const latest = new Map<string, ReviewState>()
  for (const review of [...reviews].sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))) {
    const state = review.state
    if (!review.author || (state !== 'approved' && state !== 'changes-requested' && state !== 'dismissed')) continue
    latest.set(review.author, state)
  }
  const holding = (wanted: ReviewState) => [...latest].filter(([, state]) => state === wanted).map(([author]) => author)
  const blocking = holding('changes-requested')
  if (blocking.length) return { state: 'changes-requested', reviewers: blocking }
  const approving = holding('approved')
  return approving.length ? { state: 'approved', reviewers: approving } : { state: 'none', reviewers: [] }
}

function shouldShowReviewSummary(review: Review): boolean {
  return hasRenderableBody(review.body) || review.state !== 'commented'
}

function byTime<T extends { createdAt: number | null }>(a: T, b: T): number {
  return (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER)
}

export const threadComments = (thread: Thread) => [...thread.comments].sort(byTime)
function firstThreadComment(thread: Thread): Thread['comments'][number] | undefined {
  let first: Thread['comments'][number] | undefined
  for (const comment of thread.comments) if (!first || byTime(comment, first) < 0) first = comment
  return first
}
const threadCreatedAt = (thread: Thread) => firstThreadComment(thread)?.createdAt ?? null

// `key` is the turn's identity in the conversation's Timeline: the kind and the provider's id, so a
// commit SHA, a review's id and a comment's id can never collide. It survives a refetch, a body
// arriving and a sort tie, which is what lets a turn keep its element.
export type ConversationEntry =
  | { kind: 'review'; id: string; key: string; createdAt: number | null; review: Review }
  | { kind: 'comment'; id: string; key: string; createdAt: number | null; comment: Comment }
  | { kind: 'commit'; id: string; key: string; createdAt: number | null; commit: Commit }
  | { kind: 'thread'; id: string; key: string; createdAt: number | null; thread: Thread }

type Unkeyed<T> = T extends unknown ? Omit<T, 'key'> : never

/**
 * Every turn of a change request's conversation, oldest first. The sort is stable, so turns with the
 * same time keep the order they are listed in here. A provider id seen twice in one kind gets a
 * numbered key rather than a duplicate one, numbered by that same order, so the list never falls back
 * to keying by position.
 */
export function buildConversationEntries(data: ChangeRequestDetail | undefined): ConversationEntry[] {
  if (!data) return []
  const entries: Unkeyed<ConversationEntry>[] = [
    ...data.reviews
      .filter(shouldShowReviewSummary)
      .map((review) => ({ kind: 'review' as const, id: review.id, createdAt: review.submittedAt, review })),
    ...data.comments.map((comment) => ({
      kind: 'comment' as const,
      id: comment.id,
      createdAt: comment.createdAt,
      comment,
    })),
    ...data.commits.map((commit) => ({
      kind: 'commit' as const,
      id: commit.sha,
      createdAt: commit.committedAt,
      commit,
    })),
    ...data.threads
      .filter((thread) => thread.comments.length > 0)
      .map((thread) => ({ kind: 'thread' as const, id: thread.threadId, createdAt: threadCreatedAt(thread), thread })),
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
