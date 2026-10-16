import type { DiffFile } from '../../diff/diffModel'
import type { RailMarkerDot } from '../../tokens/rail'

type FileStatusTone = 'ok' | 'danger' | 'warn' | 'muted'

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

/** Map a rail marker's dot state to the kit's StatusDot props. */
export const railDotProps = (
  dot: RailMarkerDot,
): { tone: 'ok' | 'warn' | 'danger'; mixed?: boolean; diff?: boolean } =>
  dot === 'mixed'
    ? { tone: 'danger', mixed: true }
    : dot === 'diff'
      ? { tone: 'ok', diff: true }
      : { tone: dot === 'bad' ? 'danger' : dot }
