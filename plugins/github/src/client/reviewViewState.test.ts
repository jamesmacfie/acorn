import { describe, expect, it } from 'vitest'
import {
  evictReviewViewStates,
  rememberReviewDiffScroll,
  rememberReviewNavigatorScroll,
  reviewDiffScroll,
  reviewNavigatorScroll,
} from './reviewViewState'

describe('review view state', () => {
  it('keeps navigator and diff positions together while isolating task and browse scopes', () => {
    const taskScope = { taskId: 'review-state-task', routeKey: 'oak/acorn#42' }
    const browseScope = { routeKey: 'oak/acorn#42' }
    rememberReviewNavigatorScroll(taskScope, { top: 320, left: 0 })
    rememberReviewDiffScroll(taskScope, {
      top: 4_800,
      left: 120,
      viewMode: 'split',
      filesSignature: 'src/a.ts:sha',
    })
    rememberReviewDiffScroll(browseScope, {
      top: 80,
      left: 0,
      viewMode: 'unified',
      filesSignature: 'src/a.ts:sha',
    })

    expect(reviewNavigatorScroll(taskScope)).toEqual({ top: 320, left: 0 })
    expect(reviewDiffScroll(taskScope)).toEqual({
      top: 4_800,
      left: 120,
      viewMode: 'split',
      filesSignature: 'src/a.ts:sha',
    })
    expect(reviewNavigatorScroll(browseScope)).toBeUndefined()
    expect(reviewDiffScroll(browseScope)?.top).toBe(80)
  })

  it('evicts every review position owned by an archived task', () => {
    const first = { taskId: 'archived-review-task', routeKey: 'oak/acorn#1' }
    const second = { taskId: 'archived-review-task', routeKey: 'oak/acorn#2' }
    const retained = { routeKey: 'oak/acorn#1' }
    rememberReviewNavigatorScroll(first, { top: 10, left: 0 })
    rememberReviewDiffScroll(second, {
      top: 20,
      left: 0,
      viewMode: 'unified',
      filesSignature: 'signature',
    })
    rememberReviewNavigatorScroll(retained, { top: 30, left: 0 })

    evictReviewViewStates('archived-review-task')

    expect(reviewNavigatorScroll(first)).toBeUndefined()
    expect(reviewDiffScroll(second)).toBeUndefined()
    expect(reviewNavigatorScroll(retained)?.top).toBe(30)
  })
})
