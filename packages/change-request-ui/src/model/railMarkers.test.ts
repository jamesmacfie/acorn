import { describe, expect, it } from 'vitest'
import type { ChangeRequestDetail } from './types'
import { changeRequestMarkers } from './railMarkers'

const detail = (
  overrides: Partial<NonNullable<ChangeRequestDetail['request']>> = {},
  rest: Partial<ChangeRequestDetail> = {},
): ChangeRequestDetail => ({
  request: {
    number: 12,
    title: 'Fix it',
    state: 'open',
    draft: false,
    author: 'ada',
    headRef: 'fix',
    baseRef: 'main',
    updatedAt: null,
    body: null,
    headSha: 'a',
    conflicting: false,
    ...overrides,
  },
  labels: [],
  reviews: [],
  reviewers: [],
  comments: [],
  commits: [],
  checks: [],
  threads: [],
  ...rest,
})

describe("a change request pane button's marks", () => {
  it('shows nothing for an open change request with nothing to say', () => {
    expect(changeRequestMarkers(detail())).toEqual([])
  })

  it('marks a running pipeline, an approval, and conflicts in their corners', () => {
    const marks = changeRequestMarkers(
      detail(
        { conflicting: true },
        {
          checks: [{ name: 'test', status: 'in_progress', url: null, runId: 1 }],
          reviews: [{ id: 'a', author: 'grace', state: 'approved', body: null, submittedAt: null }],
        },
      ),
    )
    expect(marks.map((mark) => [mark.id, mark.placements[0], mark.label])).toEqual([
      ['checks', 'top-end', '1 check running'],
      ['review', 'bottom-end', 'Approved by grace'],
      ['conflicts', 'bottom-start', 'Merge conflicts with main'],
    ])
  })

  it('marks a request for changes, which only GitHub and Bitbucket send', () => {
    const marks = changeRequestMarkers(
      detail(
        {},
        { reviews: [{ id: 'a', author: 'linus', state: 'changes-requested', body: null, submittedAt: null }] },
      ),
    )
    expect(marks).toEqual([
      expect.objectContaining({ id: 'review', label: 'Changes requested by linus', tone: 'warn' }),
    ])
  })

  it('shows only the state once the change request is merged or closed', () => {
    expect(changeRequestMarkers(detail({ state: 'merged', conflicting: true }))).toEqual([
      expect.objectContaining({ id: 'state', label: 'Merged' }),
    ])
    expect(changeRequestMarkers(detail({ state: 'closed' }))).toEqual([
      expect.objectContaining({ id: 'state', label: 'Closed' }),
    ])
  })
})
