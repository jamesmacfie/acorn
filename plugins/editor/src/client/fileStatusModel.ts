import type { EditorFileChange, EditorFileStatusSnapshot } from '../contract/fileStatus'

export type FileMark = { letter: string; tone: 'muted' | 'ok' | 'accent' | 'danger'; label: string }
export type FolderMark = { count: number; conflicts: number; label: string; tone: 'muted' | 'danger' }
export type FileStatusProjection = { files: ReadonlyMap<string, FileMark>; folders: ReadonlyMap<string, FolderMark> }

const rank: Record<EditorFileChange['status'], number> = {
  deleted: 0, modified: 1, untracked: 2, added: 3, renamed: 4, conflicted: 5,
}
const letter: Record<EditorFileChange['status'], string> = {
  deleted: 'D', modified: 'M', untracked: '?', added: 'A', renamed: 'R', conflicted: '!',
}

/** One path has one mark even when Git reports index and worktree entries separately. */
export function projectFileStatus(snapshot: EditorFileStatusSnapshot | null): FileStatusProjection {
  const files = new Map<string, FileMark>()
  const folders = new Map<string, FolderMark>()
  if (snapshot?.kind !== 'ready') return { files, folders }
  const byPath = new Map<string, EditorFileChange[]>()
  for (const change of snapshot.changes) {
    if (!change.path || change.path.startsWith('/') || change.path.split('/').includes('..')) continue
    const entries = byPath.get(change.path) ?? []
    entries.push(change)
    byPath.set(change.path, entries)
  }
  const folderPaths = new Map<string, { count: number; conflicts: number }>()
  for (const [path, entries] of byPath) {
    const primary = entries.reduce((best, entry) => rank[entry.status] > rank[best.status] ? entry : best)
    const staged = entries.some((entry) => entry.staged)
    const unstaged = entries.some((entry) => !entry.staged)
    const scope = staged && unstaged ? 'Staged and unstaged' : staged ? 'Staged' : 'Unstaged'
    const name = primary.status[0]!.toUpperCase() + primary.status.slice(1)
    files.set(path, {
      letter: letter[primary.status],
      tone: primary.status === 'conflicted' ? 'danger' : primary.status === 'renamed' ? 'accent'
        : primary.status === 'added' || primary.status === 'untracked' ? 'ok' : 'muted',
      label: `${name} — ${scope}${primary.oldPath ? `; renamed from ${primary.oldPath}` : ''}`,
    })
    const parts = path.split('/')
    for (let at = 1; at < parts.length; at++) {
      const folder = parts.slice(0, at).join('/')
      const totals = folderPaths.get(folder) ?? { count: 0, conflicts: 0 }
      totals.count++
      if (primary.status === 'conflicted') totals.conflicts++
      folderPaths.set(folder, totals)
    }
  }
  for (const [path, totals] of folderPaths) folders.set(path, {
    ...totals,
    label: `${totals.count} changed ${totals.count === 1 ? 'path' : 'paths'}, ${totals.conflicts} ${totals.conflicts === 1 ? 'conflict' : 'conflicts'}`,
    tone: totals.conflicts ? 'danger' : 'muted',
  })
  return { files, folders }
}
