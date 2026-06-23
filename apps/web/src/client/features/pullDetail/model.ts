import gitdiffParser from 'gitdiff-parser'
import { synth } from '../../diff'
import type { Comment, PullDetail, PullFile, Review, Thread } from '../../queries'

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

export type ConversationEntry =
  | { kind: 'review'; id: string; createdAt: number | null; review: Review }
  | { kind: 'comment'; id: string; createdAt: number | null; comment: Comment }
  | { kind: 'thread'; id: string; createdAt: number | null; thread: Thread }

export type SnippetLine = {
  kind: 'normal' | 'insert' | 'delete'
  oldNo: number | null
  newNo: number | null
  text: string
}

export function buildConversationEntries(data: PullDetail | undefined): ConversationEntry[] {
  if (!data) return []
  return [
    ...data.reviews.filter(shouldShowReviewSummary).map((review) => ({ kind: 'review' as const, id: review.id, createdAt: review.submittedAt, review })),
    ...data.comments.map((comment) => ({ kind: 'comment' as const, id: comment.id, createdAt: comment.createdAt, comment })),
    ...data.threads.filter((thread) => thread.comments.length > 0).map((thread) => ({ kind: 'thread' as const, id: thread.threadId, createdAt: threadCreatedAt(thread), thread })),
  ].sort((a, b) => (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER))
}

export function threadSnippet(thread: Thread, files: PullFile[] | undefined): SnippetLine[] {
  if (!thread.path || thread.line == null) return []
  const file = files?.find((f) => f.path === thread.path)
  if (!file?.patch) return []

  const targetSide = thread.side === 'LEFT' ? 'LEFT' : 'RIGHT'
  try {
    const [parsed] = gitdiffParser.parse(synth(file.path, file.patch))
    const rows: SnippetLine[] = []
    for (const hunk of parsed?.hunks ?? []) {
      for (const change of hunk.changes) {
        if (change.type === 'normal') {
          rows.push({ kind: 'normal', oldNo: change.oldLineNumber, newNo: change.newLineNumber, text: change.content })
        } else if (change.type === 'insert') {
          rows.push({ kind: 'insert', oldNo: null, newNo: change.lineNumber, text: change.content })
        } else {
          rows.push({ kind: 'delete', oldNo: change.lineNumber, newNo: null, text: change.content })
        }
      }
    }
    const index = rows.findIndex((row) => (targetSide === 'LEFT' ? row.oldNo : row.newNo) === thread.line)
    if (index < 0) return []
    return rows.slice(Math.max(index - 2, 0), index + 3)
  } catch {
    return []
  }
}
