import type { RailMarkerDot } from '@acorn/plugin-api/client'

// Statuses that count as a failed check, which a host may offer to re-run.
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

export const CHECK_TONE: Record<ReturnType<typeof checksState>, RailMarkerDot> = {
  success: 'ok',
  failure: 'bad',
  pending: 'warn',
  mixed: 'mixed',
}

/** Tone for one check's status, for the per-check list under the roll-up dot. */
export const checkStatusTone = (status: string | null): 'ok' | 'warn' | 'danger' | 'muted' => {
  const s = (status ?? '').toLowerCase()
  if (FAILED_STATUSES.has(s)) return 'danger'
  if (IN_PROGRESS_STATUSES.has(s)) return 'warn'
  return s === 'success' ? 'ok' : 'muted'
}

// One word for every status a check can report (the vocabulary on `Check.status`). Compared without
// case, because GitHub sends its statuses in upper case.
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

/** Every check on a change request in one phrase: what is failing, else what needs a person, else what
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
