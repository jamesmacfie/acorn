import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type { PullDetail, PullFile, Thread } from '../../queries'
import { buildConversationEntries, buildThreadSnippetIndex, hasRenderableBody, reviewAction, threadSnippet, threadSnippetFromIndex } from './model'

const baseDetail = (overrides: Partial<PullDetail> = {}): PullDetail => ({
  pull: null,
  labels: [],
  reviews: [],
  comments: [],
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

const file = (patch: string): PullFile => ({
  path: 'src/app.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: 'sha',
  viewed: false,
  patch,
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

  it('sorts reviews, comments, and non-empty threads by first visible time', () => {
    const entries = buildConversationEntries(
      baseDetail({
        reviews: [{ id: 'r1', author: 'a', state: 'APPROVED', body: null, submittedAt: 20 }],
        comments: [{ id: 'c1', author: 'c', body: '<p>comment</p>', createdAt: 10 }],
        threads: [thread('t1')],
      }),
    )

    expect(entries.map((entry) => entry.kind)).toEqual(['comment', 'review', 'thread'])
  })

  it('extracts thread snippets on the requested diff side', () => {
    const patch = ['@@ -1,4 +1,4 @@', ' const a = 1', '-const oldName = a', '+const newName = a', ' export { a }'].join('\n')

    expect(threadSnippet(thread('left', 'src/app.ts', 2, 'LEFT'), [file(patch)]).map((row) => row.kind)).toContain('delete')
    expect(threadSnippet(thread('right', 'src/app.ts', 2, 'RIGHT'), [file(patch)]).map((row) => row.kind)).toContain('insert')
  })

  it('serves multiple thread snippets from one parsed file index', () => {
    const patch = ['@@ -1,6 +1,6 @@', ' const a = 1', '-const oldName = a', '+const newName = a', ' export { a }', '-oldTail()', '+newTail()'].join('\n')
    const index = buildThreadSnippetIndex([file(patch)])

    expect(index.get('src/app.ts')).toHaveLength(6)
    expect(threadSnippetFromIndex(thread('right-name', 'src/app.ts', 2, 'RIGHT'), index).map((row) => row.kind)).toContain('insert')
    expect(threadSnippetFromIndex(thread('right-tail', 'src/app.ts', 4, 'RIGHT'), index).map((row) => row.text)).toContain('newTail()')
  })

  it('keeps large conversation merging within the speed budget', () => {
    const detail = baseDetail({
      comments: Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}`, author: 'octo', body: '<p>x</p>', createdAt: i })),
      reviews: Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, author: 'octo', state: 'APPROVED', body: null, submittedAt: i + 1000 })),
      threads: Array.from({ length: 1000 }, (_, i) => ({
        ...thread(`t${i}`),
        comments: [{ id: `tc${i}`, databaseId: i, author: 'octo', body: '<p>x</p>', createdAt: i + 2000 }],
      })),
    })

    const start = performance.now()
    const entries = buildConversationEntries(detail)
    const elapsed = performance.now() - start

    expect(entries).toHaveLength(3000)
    expect(elapsed).toBeLessThan(250)
  })
})
