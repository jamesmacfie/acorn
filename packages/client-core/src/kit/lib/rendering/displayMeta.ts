import type { DiffFile } from '../../diff/diffModel'
import type { RailMarkerDot } from '../../tokens/rail'

export type FileStatusTone = 'ok' | 'danger' | 'warn' | 'muted'

export type FileStatusMeta = {
  letter: string
  label: string
  tone: FileStatusTone
}

export function fileStatusMeta(status: string | null | undefined): FileStatusMeta {
  switch ((status ?? 'modified').toLowerCase()) {
    case 'added':
    case 'add':
    case 'new':
      return { letter: 'A', label: 'Added', tone: 'ok' }
    case 'removed':
    case 'deleted':
    case 'delete':
      return { letter: 'D', label: 'Deleted', tone: 'danger' }
    case 'renamed':
    case 'rename':
      return { letter: 'R', label: 'Renamed', tone: 'warn' }
    case 'copied':
    case 'copy':
      return { letter: 'C', label: 'Copied', tone: 'muted' }
    case 'changed':
    case 'modified':
    default:
      return { letter: 'M', label: 'Modified', tone: 'warn' }
  }
}

export function summarizeFileStats(files: readonly Pick<DiffFile, 'additions' | 'deletions'>[] | undefined): {
  count: number
  additions: number
  deletions: number
} {
  let additions = 0
  let deletions = 0
  for (const file of files ?? []) {
    additions += file.additions ?? 0
    deletions += file.deletions ?? 0
  }
  return { count: files?.length ?? 0, additions, deletions }
}

export function githubAvatarUrl(login: string, size = 40): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`
}

// Conclusions that count as a failed check → eligible for "Rerun failed jobs".
export const FAILED_STATUSES = new Set(['failure', 'error', 'startup_failure', 'cancelled', 'timed_out'])
const IN_PROGRESS_STATUSES = new Set(['pending', 'in_progress', 'queued', 'requested', 'waiting', 'expected'])

// Roll the individual check statuses up to one dot: red if any failed, green if all
// passed, in-progress if any still running, and split red/in-progress if both.
export function checksState(checks: readonly { status: string | null }[]): 'success' | 'failure' | 'pending' | 'mixed' {
  let failed = false
  let pending = false
  for (const c of checks) {
    const s = (c.status ?? '').toLowerCase()
    if (FAILED_STATUSES.has(s)) failed = true
    else if (IN_PROGRESS_STATUSES.has(s)) pending = true
  }
  if (failed && pending) return 'mixed'
  if (failed) return 'failure'
  if (pending) return 'pending'
  return 'success'
}

/** Map a rail marker's dot state to the kit's StatusDot props. */
export const railDotProps = (dot: RailMarkerDot): { tone: 'ok' | 'warn' | 'danger'; mixed?: boolean } =>
  dot === 'mixed' ? { tone: 'danger', mixed: true } : { tone: dot === 'bad' ? 'danger' : dot }

export const CHECK_TONE: Record<ReturnType<typeof checksState>, RailMarkerDot> = {
  success: 'ok',
  failure: 'bad',
  pending: 'warn',
  mixed: 'mixed',
}

/** Tone for one raw check conclusion, for the per-check list under a PR's roll-up dot. */
export const checkStatusTone = (status: string | null): 'ok' | 'warn' | 'danger' | 'muted' => {
  const s = (status ?? '').toLowerCase()
  if (FAILED_STATUSES.has(s)) return 'danger'
  if (IN_PROGRESS_STATUSES.has(s)) return 'warn'
  return s === 'success' ? 'ok' : 'muted'
}

// One word for every status a check can report: a check run's conclusion or, before it has one, its
// status, and a commit status context's state. GitHub sends these in upper case.
const CHECK_WORDS: Record<string, string> = {
  success: 'Passed',
  failure: 'Failed',
  error: 'Failed',
  startup_failure: 'Failed',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
  skipped: 'Skipped',
  neutral: 'Neutral',
  stale: 'Stale',
  action_required: 'Needs action',
  in_progress: 'Running',
  queued: 'Queued',
  requested: 'Queued',
  pending: 'Waiting',
  waiting: 'Waiting',
  expected: 'Waiting',
  completed: 'Finished',
}

/** A check's status as a word a person reads. A check with no status has not started. */
export const checkStatusWord = (status: string | null | undefined): string => {
  const key = (status ?? '').toLowerCase()
  if (!key) return 'Waiting'
  const word = CHECK_WORDS[key]
  if (word) return word
  const spaced = key.replaceAll('_', ' ')
  return spaced[0]!.toUpperCase() + spaced.slice(1)
}

/** Every check on a pull request in one phrase: what is failing, else what needs a person, else what
 *  is still running, else that everything passed. */
export function checksSummary(checks: readonly { status: string | null }[]): string {
  if (!checks.length) return 'No checks'
  let failing = 0
  let needsAction = 0
  let running = 0
  for (const check of checks) {
    const status = (check.status ?? '').toLowerCase()
    if (FAILED_STATUSES.has(status)) failing += 1
    else if (status === 'action_required') needsAction += 1
    else if (!status || IN_PROGRESS_STATUSES.has(status)) running += 1
  }
  const counted = (count: number) => `${count} check${count === 1 ? '' : 's'}`
  if (failing) return `${counted(failing)} failing`
  if (needsAction) return `${counted(needsAction)} ${needsAction === 1 ? 'needs' : 'need'} action`
  if (running) return `${counted(running)} running`
  return 'All checks passed'
}
