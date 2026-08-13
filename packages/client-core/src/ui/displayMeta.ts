import type { DiffFile } from './diff/model'

export type FileStatusTone = 'add' | 'del' | 'warn' | 'muted'

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
      return { letter: 'A', label: 'added', tone: 'add' }
    case 'removed':
    case 'deleted':
    case 'delete':
      return { letter: 'D', label: 'deleted', tone: 'del' }
    case 'renamed':
    case 'rename':
      return { letter: 'R', label: 'renamed', tone: 'warn' }
    case 'copied':
    case 'copy':
      return { letter: 'C', label: 'copied', tone: 'muted' }
    case 'changed':
    case 'modified':
    default:
      return { letter: 'M', label: 'modified', tone: 'warn' }
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
export const FAILED_STATUSES = new Set(['failure', 'error', 'cancelled', 'timed_out'])
const IN_PROGRESS_STATUSES = new Set(['pending', 'in_progress', 'queued'])

// Roll the individual check statuses up to one dot: red if any failed, green if all
// passed, in-progress if any still running, and split red/in-progress if both.
export function checksState(checks: { status: string | null }[]): 'success' | 'failure' | 'pending' | 'mixed' {
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

// The domain→semantic hop StatusDot asks its call sites to make, declared once. Both the rail
// (tasks/railStatus.ts) and the GitHub plugin's PR rows draw this dot, and before this they shared a
// class defined in the plugin's own stylesheet — so core's markup went unstyled when it was disabled.
export const CHECK_TONE: Record<ReturnType<typeof checksState>, 'ok' | 'warn' | 'bad' | 'mixed'> = {
  success: 'ok',
  failure: 'bad',
  pending: 'warn',
  mixed: 'mixed',
}

/** Tone for ONE raw check conclusion, for the per-check list under a PR's roll-up dot. */
export const checkStatusTone = (status: string | null): 'ok' | 'warn' | 'bad' | 'muted' => {
  const s = (status ?? '').toLowerCase()
  if (FAILED_STATUSES.has(s)) return 'bad'
  if (IN_PROGRESS_STATUSES.has(s)) return 'warn'
  return s === 'success' ? 'ok' : 'muted'
}
