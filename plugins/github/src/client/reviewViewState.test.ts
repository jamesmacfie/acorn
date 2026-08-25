import { describe, expect, it } from 'vitest'
import { evictReviewViewStates, rememberReviewNavigatorScroll, reviewNavigatorScroll } from './reviewViewState'

// The diff column's own scroll and collapse memory is client-core's, and tested beside it in
// diff/viewState.test.ts. What is left here is the navigator: the summary column PullDetail draws.
describe('review navigator scroll', () => {
  it('isolates a task scope from the classic browser showing the same pull request', () => {
    const taskScope = { taskId: 'review-state-task', routeKey: 'oak/acorn#42' }
    const browseScope = { routeKey: 'oak/acorn#42' }
    rememberReviewNavigatorScroll(taskScope, { top: 320, left: 0 })

    expect(reviewNavigatorScroll(taskScope)).toEqual({ top: 320, left: 0 })
    expect(reviewNavigatorScroll(browseScope)).toBeUndefined()
  })

  it('evicts every position owned by an archived task', () => {
    const first = { taskId: 'archived-review-task', routeKey: 'oak/acorn#1' }
    const retained = { routeKey: 'oak/acorn#1' }
    rememberReviewNavigatorScroll(first, { top: 10, left: 0 })
    rememberReviewNavigatorScroll(retained, { top: 30, left: 0 })

    evictReviewViewStates('archived-review-task')

    expect(reviewNavigatorScroll(first)).toBeUndefined()
    expect(reviewNavigatorScroll(retained)?.top).toBe(30)
  })
})
