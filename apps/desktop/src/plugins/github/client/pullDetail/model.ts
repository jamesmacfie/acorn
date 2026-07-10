import gitdiffParser from 'gitdiff-parser'
import { synth } from '../diff'
import type { Comment, PullCommit, PullDetail, PullFile, Review, Thread } from '../../../../core/client/queries'

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
  | { kind: 'commit'; id: string; createdAt: number | null; commit: PullCommit }
  | { kind: 'thread'; id: string; createdAt: number | null; thread: Thread }

export type SnippetLine = {
  kind: 'normal' | 'insert' | 'delete'
  oldNo: number | null
  newNo: number | null
  text: string
}
export type ThreadSnippetIndex = Map<string, SnippetLine[]>

export function buildConversationEntries(data: PullDetail | undefined): ConversationEntry[] {
  if (!data) return []
  return [
    ...data.reviews.filter(shouldShowReviewSummary).map((review) => ({ kind: 'review' as const, id: review.id, createdAt: review.submittedAt, review })),
    ...data.comments.map((comment) => ({ kind: 'comment' as const, id: comment.id, createdAt: comment.createdAt, comment })),
    ...data.commits.map((commit) => ({ kind: 'commit' as const, id: commit.sha, createdAt: commit.committedAt, commit })),
    ...data.threads.filter((thread) => thread.comments.length > 0).map((thread) => ({ kind: 'thread' as const, id: thread.threadId, createdAt: threadCreatedAt(thread), thread })),
  ].sort((a, b) => (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER))
}

export function buildThreadSnippetIndex(files: PullFile[] | undefined): ThreadSnippetIndex {
  const index: ThreadSnippetIndex = new Map()
  for (const file of files ?? []) {
    if (!file.patch) continue
    index.set(file.path, parseSnippetRows(file, file.patch))
  }
  return index
}

function parseSnippetRows(file: PullFile, patch: string): SnippetLine[] {
  try {
    const [parsed] = gitdiffParser.parse(synth(file.path, patch))
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
    return rows
  } catch {
    return []
  }
}

export function threadSnippetFromIndex(thread: Thread, index: ThreadSnippetIndex): SnippetLine[] {
  if (!thread.path || thread.line == null) return []
  const rows = index.get(thread.path)
  if (!rows?.length) return []

  const targetSide = thread.side === 'LEFT' ? 'LEFT' : 'RIGHT'
  const lineIndex = rows.findIndex((row) => (targetSide === 'LEFT' ? row.oldNo : row.newNo) === thread.line)
  if (lineIndex < 0) return []
  return rows.slice(Math.max(lineIndex - 2, 0), lineIndex + 3)
}

export function threadSnippet(thread: Thread, files: PullFile[] | undefined): SnippetLine[] {
  return threadSnippetFromIndex(thread, buildThreadSnippetIndex(files))
}
