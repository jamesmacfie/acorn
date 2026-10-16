// The provider-neutral change request the shared views read. Each code host plugin maps its own API
// records onto these and keeps its queries, mutations, and routes to itself
// (docs/plugins/change-request-ui.md).
//
// A field one host lacks is optional, and a view hides what's absent.

export type ChangeRequestState = 'open' | 'closed' | 'merged'

/** One row of a change request list. */
export type ChangeRequestSummary = {
  number: number
  title: string
  state: ChangeRequestState
  draft: boolean
  author: string | null
  /** Null when the host's list didn't say, such as a search hit. */
  headRef: string | null
  baseRef: string | null
  updatedAt: number | null
}

type ChangeRequest = ChangeRequestSummary & {
  /** Provider-rendered HTML. The view sanitizes it before it draws it. */
  body: string | null
  headSha: string | null
  /** The host merges it on its own once its checks pass. */
  autoMergeEnabled?: boolean
  /** The host won't merge it yet for a reason other than conflicts, such as a required review. */
  mergeBlocked?: boolean
  /** The source branch conflicts with the target branch. */
  conflicting?: boolean
}

/** A CSS color, `#` included. */
export type Label = { name: string; color: string | null }

/** A reviewer's verdict. GitLab and Bitbucket approvals are `approved`. Only GitHub sends
 *  `changes-requested`. */
export type ReviewState = 'approved' | 'changes-requested' | 'commented' | 'dismissed' | 'pending'

export type Review = {
  id: string
  author: string | null
  state: ReviewState | null
  body: string | null
  submittedAt: number | null
}

export type Comment = { id: string; author: string | null; body: string | null; createdAt: number | null }

export type Commit = {
  sha: string
  message: string
  author: string | null
  authorLogin: string | null
  committedAt: number | null
}

/**
 * One check. `status` is one of the words `checkStatusWord` knows: `success`, `failure`,
 * `error`, `cancelled`, `timed_out`, `skipped`, `neutral`, `action_required`, `in_progress`, `queued`,
 * `pending`, and the rest of that table, compared without case. A host maps its own statuses onto them.
 */
export type Check = {
  name: string
  status: string | null
  url: string | null
  /** The host's id for what ran the check, which opens its log and re-runs it. Null when it has none. */
  runId: number | null
}

export type ThreadComment = {
  id: string
  /** The id a reply is addressed to. */
  databaseId: number | null
  author: string | null
  avatarUrl?: string | null
  body: string | null
  createdAt: number | null
}

/** A review conversation pinned to a line. `old` is a deleted line's side, `new` any other line's. */
export type Thread = {
  threadId: string
  path: string | null
  line: number | null
  originalLine?: number | null
  /** Null when the host never said, which leaves the location unverified. */
  outdated?: boolean | null
  side: 'old' | 'new' | null
  resolved: boolean
  comments: ThreadComment[]
}

/** Everything one change request's pane draws, apart from its files. */
export type ChangeRequestDetail = {
  /** Moves with every new commit or base. A thread's location is trusted only when the diff has the
   *  same revision. */
  revision?: string | null
  request: ChangeRequest | null
  labels: Label[]
  reviews: Review[]
  /** People asked to review. */
  reviewers: string[]
  comments: Comment[]
  commits: Commit[]
  checks: Check[]
  threads: Thread[]
}

/** One changed file, as the file list draws it. `status` is git's word: added, modified, removed, or
 *  renamed. */
export type ChangedFile = {
  path: string
  status: string | null
  additions: number | null
  deletions: number | null
  viewed?: boolean
}
