import type { ChangeRequestState } from '@acorn/change-request-ui/model'

// Bitbucket's words in the shared views' vocabulary (docs/plugins/change-request-ui.md § The neutral
// model).

/** `OPEN`, `MERGED`, `DECLINED`, `SUPERSEDED`. A declined or superseded pull request is closed. */
export const pullRequestState = (state: string): ChangeRequestState => {
  const value = state.toUpperCase()
  return value === 'OPEN' ? 'open' : value === 'MERGED' ? 'merged' : 'closed'
}

// A build status's state as a check status. A stopped build was cancelled.
const STATUSES: Record<string, string> = {
  SUCCESSFUL: 'success',
  FAILED: 'failure',
  INPROGRESS: 'in_progress',
  STOPPED: 'cancelled',
}

export const checkStatus = (state: string | null | undefined): string | null =>
  state ? (STATUSES[state.toUpperCase()] ?? state.toLowerCase()) : null

// The same rules GitHub's CI policy and checks route use, over the check vocabulary. A check with no
// status hasn't run.
const PENDING = new Set(['queued', 'in_progress', 'pending', 'waiting'])
const PASSED = new Set(['success', 'neutral', 'skipped'])
export const checkPending = (status: string | null): boolean => !status || PENDING.has(status)
export const checkFailed = (status: string | null): boolean => !checkPending(status) && !PASSED.has(status!)

/** A participant's verdict. Bitbucket says `approved` or `changes_requested`, or nothing. */
export const verdict = (participant: { approved?: boolean; state?: string | null }): string | null =>
  participant.state === 'changes_requested'
    ? 'changes-requested'
    : participant.approved || participant.state === 'approved'
      ? 'approved'
      : null

/** Bitbucket names a commit in a pull request by a short hash, and a build status by the whole one. */
export const sameCommit = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && (a.startsWith(b) || b.startsWith(a))

export const time = (value: string | null | undefined): number | null => (value ? Date.parse(value) : null)
