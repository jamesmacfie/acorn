import { describe, expect, it } from 'vitest'
import { buildCommentsBody } from './seedTaskNotes'

describe('buildCommentsBody', () => {
  it('renders reviews, top-level comments (time-ordered) and threads with replies', () => {
    const body = buildCommentsBody({
      pull: { number: 1, title: 't', body: null },
      reviews: [
        { author: 'ana', state: 'CHANGES_REQUESTED', body: 'needs work' },
        { author: 'noise', state: 'COMMENTED', body: '' }, // empty COMMENTED review → dropped
      ],
      comments: [
        { author: 'bo', body: 'second', createdAt: 200 },
        { author: 'al', body: 'first', createdAt: 100 },
      ],
      threads: [{ path: 'a.ts', line: 42, resolved: true, comments: [
        { author: 'al', body: 'original', createdAt: 10 },
        { author: 'bo', body: 'reply', createdAt: 20 },
      ] }],
    })
    expect(body).toContain('**Review by ana — CHANGES_REQUESTED**')
    expect(body).not.toContain('noise')
    expect(body.indexOf('first')).toBeLessThan(body.indexOf('second')) // sorted by createdAt
    expect(body).toContain('**a.ts:42 — resolved**')
    expect(body.indexOf('original')).toBeLessThan(body.indexOf('reply')) // original before replies
  })

  it('returns empty string when there is nothing to say', () => {
    expect(buildCommentsBody({ pull: null, reviews: [], comments: [], threads: [] })).toBe('')
  })
})
