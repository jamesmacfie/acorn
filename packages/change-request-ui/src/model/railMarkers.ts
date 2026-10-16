import type { RailMarker } from '@acorn/plugin-api/client'
import { CHECK_TONE, checksState, checksSummary } from './checkStatus'
import { reviewDecision } from './conversation'
import type { ChangeRequestDetail } from './types'

/**
 * Where a change request stands, in the corners of its pane's rail button: checks top right, the review
 * decision bottom right, conflicts bottom left, and draft, merged, or closed top left. A merged or
 * closed one shows only that, because nothing else on it is left to act on, and an open one with
 * nothing to say gets none, because it is the normal case.
 */
export function changeRequestMarkers(detail: ChangeRequestDetail): RailMarker[] {
  const request = detail.request
  if (!request) return []
  if (request.state === 'merged')
    return [{ id: 'state', label: 'Merged', icon: 'git-merge', tone: 'accent', placements: ['top-start'] }]
  if (request.state === 'closed')
    return [{ id: 'state', label: 'Closed', icon: 'git-pull-request-closed', placements: ['top-start'] }]
  const markers: RailMarker[] = []
  if (request.draft)
    markers.push({ id: 'state', label: 'Draft', icon: 'git-pull-request-draft', placements: ['top-start'] })
  if (detail.checks.length) {
    const state = checksState(detail.checks)
    markers.push({
      id: 'checks',
      label: checksSummary(detail.checks),
      dotTone: CHECK_TONE[state],
      busy: state === 'pending' || state === 'mixed',
      placements: ['top-end'],
    })
  }
  const review = reviewDecision(detail.reviews)
  if (review.state === 'approved')
    markers.push({
      id: 'review',
      label: `Approved by ${review.reviewers.join(', ')}`,
      icon: 'check',
      placements: ['bottom-end'],
    })
  else if (review.state === 'changes-requested')
    markers.push({
      id: 'review',
      label: `Changes requested by ${review.reviewers.join(', ')}`,
      icon: 'file-diff',
      tone: 'warn',
      placements: ['bottom-end'],
    })
  if (request.conflicting)
    markers.push({
      id: 'conflicts',
      label: request.baseRef ? `Merge conflicts with ${request.baseRef}` : 'Merge conflicts',
      icon: 'triangle-alert',
      tone: 'danger',
      placements: ['bottom-start'],
    })
  return markers
}
