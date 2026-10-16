import type {
  ChangeRequestDetail,
  ChangeRequestState,
  ChangeRequestSummary,
  Review,
  ReviewState,
} from '@acorn/change-request-ui/model'
import type { ChangeRequestHost } from '@acorn/change-request-ui/views'
import type { Pull, PullDetail } from '../shared/api'
import { actionFailure } from './actionErrors'
import { githubAvatarUrl } from './avatar'

// GitHub's mirror rows as the shared review views read them (docs/plugins/change-request-ui.md). The
// queries, routes and keys stay GitHub's; only what the views draw goes through here.

export const githubHost: ChangeRequestHost = {
  pluginId: 'github',
  label: 'GitHub',
  noun: 'pull request',
  prefix: '#',
  avatar: (login) => githubAvatarUrl(login),
  describeFailure: actionFailure,
}

export const GITHUB_MERGE_METHODS = [
  { value: 'squash', label: 'Squash and merge', word: 'squash' },
  { value: 'merge', label: 'Create a merge commit', word: 'merge commit' },
  { value: 'rebase', label: 'Rebase and merge', word: 'rebase' },
]

// The list route reports `open` or `closed`, and the GraphQL detail also says `merged`.
const state = (value: string): ChangeRequestState =>
  value === 'merged' ? 'merged' : value === 'open' ? 'open' : 'closed'

const REVIEW_STATES: Record<string, ReviewState> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
  PENDING: 'pending',
}

export const toReview = (review: PullDetail['reviews'][number]): Review => ({
  ...review,
  state: REVIEW_STATES[(review.state ?? '').toUpperCase()] ?? null,
})

export const toSummary = (pull: Pull): ChangeRequestSummary => ({
  number: pull.number,
  title: pull.title,
  state: state(pull.state),
  draft: pull.draft,
  author: pull.author,
  headRef: pull.headRef,
  baseRef: pull.baseRef,
  updatedAt: pull.updatedAt,
})

export function toChangeRequestDetail(detail: PullDetail): ChangeRequestDetail {
  const pull = detail.pull
  return {
    revision: detail.revision,
    request: pull && {
      ...toSummary(pull),
      body: pull.body,
      headSha: pull.headSha,
      autoMergeEnabled: pull.autoMergeEnabled,
      mergeBlocked: pull.mergeStateStatus === 'BLOCKED',
      // GitHub only says *that* a pull conflicts. The files are found by a local trial merge.
      conflicting: pull.mergeable === 'CONFLICTING',
    },
    // GitHub sends a label's color as six hex digits with no `#`.
    labels: detail.labels.map((label) => ({ name: label.name, color: label.color ? `#${label.color}` : null })),
    reviews: detail.reviews.map(toReview),
    reviewers: detail.requestedReviewers,
    comments: detail.comments,
    commits: detail.commits,
    checks: detail.checks,
    threads: detail.threads.map((thread) => ({
      ...thread,
      side: thread.side === 'LEFT' ? 'old' : thread.side === 'RIGHT' ? 'new' : null,
    })),
  }
}
