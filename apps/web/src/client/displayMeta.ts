import type { PullFile } from './queries'

export function formatRelativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null || Number.isNaN(ms)) return ''
  const elapsed = Math.max(0, now - ms)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day

  if (elapsed < minute) return 'now'
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`
  if (elapsed < month) return `${Math.floor(elapsed / day)}d ago`
  return `${Math.floor(elapsed / month)}mo ago`
}

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

export function summarizeFileStats(files: readonly Pick<PullFile, 'additions' | 'deletions'>[] | undefined): {
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
