import type { ChangeRequestState } from '@acorn/change-request-ui/model'

// GitLab's words in the shared views' vocabulary (docs/plugins/change-request-ui.md § The neutral model).

/** `opened`, `closed`, `locked`, `merged`, in either case. A locked merge request can't be acted on. */
export const mergeRequestState = (state: string): ChangeRequestState => {
  const value = state.toLowerCase()
  return value === 'opened' ? 'open' : value === 'merged' ? 'merged' : 'closed'
}

// A job's or pipeline's status as a check status. A manual job waits for a person and doesn't block
// the pipeline, so it reads as skipped. A failed job that's allowed to fail reads as neutral.
const JOB_STATUSES: Record<string, string> = {
  success: 'success',
  failed: 'failure',
  canceled: 'cancelled',
  canceling: 'cancelled',
  running: 'in_progress',
  pending: 'pending',
  created: 'queued',
  preparing: 'queued',
  scheduled: 'queued',
  waiting_for_resource: 'waiting',
  waiting_for_callback: 'waiting',
  manual: 'skipped',
  skipped: 'skipped',
}

export const checkStatus = (status: string | null, allowFailure = false): string | null => {
  if (!status) return null
  const value = status.toLowerCase()
  if (value === 'failed' && allowFailure) return 'neutral'
  return JOB_STATUSES[value] ?? value
}

// The same rules GitHub's CI policy and checks route use, over the check vocabulary. A check with no
// status hasn't run.
const PENDING = new Set(['queued', 'in_progress', 'pending', 'waiting'])
const PASSED = new Set(['success', 'neutral', 'skipped'])
export const checkPending = (status: string | null): boolean => !status || PENDING.has(status)
export const checkFailed = (status: string | null): boolean => !checkPending(status) && !PASSED.has(status!)

/**
 * GitLab's rendered HTML, made to stand on its own: links and images are root-relative on the server at
 * `origin`, and images load lazily from `data-src` behind a placeholder `src`.
 */
export const standaloneHtml = (origin: string, html: string | null | undefined): string | null =>
  html
    ? html
        .replace(/\ssrc="data:[^"]*"/g, '')
        .replace(/\sdata-src="/g, ' src="')
        .replace(/\s(href|src)="\/(?!\/)/g, ` $1="${origin}/`)
    : null

/** An avatar URL GitLab may send root-relative to the server at `origin`. */
export const absoluteUrl = (origin: string, url: string | null | undefined): string | null =>
  url ? (url.startsWith('/') ? `${origin}${url}` : url) : null
