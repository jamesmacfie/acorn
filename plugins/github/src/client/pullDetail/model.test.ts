import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type { PullDetail, Thread } from '../../shared/api'
import { buildConversationEntries, hasRenderableBody, reviewAction, reviewDecision } from './model'

const baseDetail = (overrides: Partial<PullDetail> = {}): PullDetail => ({
  pull: null,
  labels: [],
  reviews: [],
  requestedReviewers: [],
  comments: [],
  commits: [],
  checks: [],
  threads: [],
  ...overrides,
})

const thread = (id: string, path = 'src/app.ts', line = 2, side: 'LEFT' | 'RIGHT' | null = 'RIGHT'): Thread => ({
  threadId: id,
  path,
  line,
  side,
  resolved: false,
  comments: [{ id: `${id}:c1`, databaseId: 1, author: 'octo', body: '<p>note</p>', createdAt: 30 }],
})

describe('pull detail model', () => {
  it('maps review states and filters empty commented summaries', () => {
    expect(reviewAction('CHANGES_REQUESTED')).toBe('requested changes')
    expect(reviewAction('CUSTOM_STATE')).toBe('custom state')
    expect(hasRenderableBody('<p>&nbsp;</p>')).toBe(false)
    expect(hasRenderableBody('<pre>code</pre>')).toBe(true)

    const entries = buildConversationEntries(
      baseDetail({
        reviews: [
          { id: 'r1', author: 'a', state: 'COMMENTED', body: '<p>&nbsp;</p>', submittedAt: 10 },
          { id: 'r2', author: 'b', state: 'APPROVED', body: null, submittedAt: 20 },
        ],
      }),
    )

    expect(entries.map((entry) => entry.id)).toEqual(['r2'])
  })

  it('sorts reviews, comments, commits, and non-empty threads by first visible time', () => {
    const entries = buildConversationEntries(
      baseDetail({
        reviews: [{ id: 'r1', author: 'a', state: 'APPROVED', body: null, submittedAt: 20 }],
        comments: [{ id: 'c1', author: 'c', body: '<p>comment</p>', createdAt: 10 }],
        commits: [{ sha: 'abc1234', message: 'ship it', author: 'Ada', authorLogin: 'ada', committedAt: 25 }],
        threads: [thread('t1')],
      }),
    )

    expect(entries.map((entry) => entry.kind)).toEqual(['comment', 'review', 'commit', 'thread'])
  })

  it('keys every turn by its kind and id, whatever arrives, changes or ties around it', () => {
    const review = { id: 'x1', author: 'a', state: 'APPROVED', body: null, submittedAt: 20 }
    const comment = { id: 'x1', author: 'c', body: '<p>one</p>', createdAt: 20 }
    const first = buildConversationEntries(baseDetail({ reviews: [review], comments: [comment], threads: [thread('t1')] }))
    // The same id in two kinds is two turns, and a tie keeps the order the kinds are listed in.
    expect(first.map((entry) => entry.key)).toEqual(['review:x1', 'comment:x1', 'thread:t1'])

    // An older comment arrives, a body changes, and a reply lands on the thread: every key holds.
    const next = buildConversationEntries(baseDetail({
      reviews: [review],
      comments: [{ id: 'c0', author: 'd', body: '<p>early</p>', createdAt: 1 }, { ...comment, body: '<p>edited</p>' }],
      threads: [{ ...thread('t1'), comments: [...thread('t1').comments, { id: 't1:c2', databaseId: 2, author: 'b', body: '<p>reply</p>', createdAt: 40 }] }],
    }))
    expect(next.map((entry) => entry.key)).toEqual(['comment:c0', 'review:x1', 'comment:x1', 'thread:t1'])
  })

  it('numbers a provider id it sees twice rather than letting two turns share a key', () => {
    const commit = { sha: 'abc', message: 'ship it', author: 'Ada', authorLogin: 'ada', committedAt: 5 }
    const entries = buildConversationEntries(baseDetail({ commits: [commit, { ...commit, committedAt: 6 }] }))
    expect(entries.map((entry) => entry.key)).toEqual(['commit:abc', 'commit:abc#2'])
  })

  it('keeps large conversation merging within the speed budget', () => {
    const detail = baseDetail({
      comments: Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}`, author: 'octo', body: '<p>x</p>', createdAt: i })),
      reviews: Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, author: 'octo', state: 'APPROVED', body: null, submittedAt: i + 1000 })),
      commits: Array.from({ length: 1000 }, (_, i) => ({ sha: `sha${i}`, message: 'commit', author: 'octo', authorLogin: 'octo', committedAt: i + 2000 })),
      threads: Array.from({ length: 1000 }, (_, i) => ({
        ...thread(`t${i}`),
        comments: [{ id: `tc${i}`, databaseId: i, author: 'octo', body: '<p>x</p>', createdAt: i + 3000 }],
      })),
    })

    const start = performance.now()
    const entries = buildConversationEntries(detail)
    const elapsed = performance.now() - start

    expect(entries).toHaveLength(4000)
    expect(elapsed).toBeLessThan(250)
  })
})

describe('reviewDecision', () => {
  const review = (author: string, state: string, submittedAt: number) => ({ id: `${author}-${submittedAt}`, author, state, body: null, submittedAt })

  it('counts each author\'s latest verdict, and a change request outweighs approvals', () => {
    expect(reviewDecision([review('ada', 'APPROVED', 1), review('grace', 'CHANGES_REQUESTED', 2)]))
      .toEqual({ state: 'changes-requested', reviewers: ['grace'] })
  })

  it('lets a later approval replace the same author\'s change request, and ignores plain comments', () => {
    expect(reviewDecision([review('grace', 'CHANGES_REQUESTED', 1), review('grace', 'APPROVED', 3), review('ada', 'COMMENTED', 4)]))
      .toEqual({ state: 'approved', reviewers: ['grace'] })
  })

  it('reads the reviews in time order, whatever order they arrive in', () => {
    expect(reviewDecision([review('grace', 'APPROVED', 5), review('grace', 'CHANGES_REQUESTED', 1)]).state).toBe('approved')
  })

  it('drops a dismissed review and says when nobody has decided', () => {
    expect(reviewDecision([review('grace', 'CHANGES_REQUESTED', 1), review('grace', 'DISMISSED', 2)]))
      .toEqual({ state: 'none', reviewers: [] })
    expect(reviewDecision([])).toEqual({ state: 'none', reviewers: [] })
  })
})

