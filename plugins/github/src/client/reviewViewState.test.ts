import { describe, expect, it } from 'vitest'
import {
  evictReviewViewStates,
  rememberReviewDiffCollapsed,
  rememberReviewDiffScroll,
  rememberReviewNavigatorScroll,
  reviewDiffCollapsed,
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

  it('keeps collapsed diff files beside the scroll position without clobbering it', () => {
    const scope = { routeKey: 'oak/acorn#7' }
    rememberReviewDiffScroll(scope, { top: 640, left: 0, viewMode: 'unified', filesSignature: 'sig-1' })
    rememberReviewDiffCollapsed(scope, { filesSignature: 'sig-1', paths: ['src/a.ts', 'src/b.ts'] })

    expect(reviewDiffCollapsed(scope)).toEqual({ filesSignature: 'sig-1', paths: ['src/a.ts', 'src/b.ts'] })
    expect(reviewDiffScroll(scope)?.top).toBe(640)
    expect(reviewDiffCollapsed({ taskId: 'other-task', routeKey: 'oak/acorn#7' })).toBeUndefined()
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
    rememberReviewDiffCollapsed(second, { filesSignature: 'signature', paths: ['src/a.ts'] })
    rememberReviewNavigatorScroll(retained, { top: 30, left: 0 })

    evictReviewViewStates('archived-review-task')

    expect(reviewNavigatorScroll(first)).toBeUndefined()
    expect(reviewDiffScroll(second)).toBeUndefined()
    expect(reviewDiffCollapsed(second)).toBeUndefined()
    expect(reviewNavigatorScroll(retained)?.top).toBe(30)
  })
})
