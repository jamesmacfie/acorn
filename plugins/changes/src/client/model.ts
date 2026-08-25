// ChangesPane model: pure grouping, ordering and selection over LocalChange[], plus the adapter
// that feeds a local patch into the shared diff pipeline (DiffFile shape, diff.ts).
import type { DiffFile } from '@acorn/plugin-api/ui/diff'
import type { LocalChange } from '@acorn/protocol/terminal.ts'

export type ChangesGroups = { staged: LocalChange[]; unstaged: LocalChange[] }

const byPath = (a: LocalChange, b: LocalChange) => a.path.localeCompare(b.path)

export function groupChanges(changes: LocalChange[]): ChangesGroups {
  return {
    staged: changes.filter((c) => c.staged).sort(byPath),
    unstaged: changes.filter((c) => !c.staged).sort(byPath),
  }
}

// Stable row identity: a file can appear in both groups.
export const changeKey = (c: Pick<LocalChange, 'staged' | 'path'>): string => `${c.staged ? 'staged' : 'unstaged'}:${c.path}`

// The stack the diff column shows: every change in the selected row's staging area, in list order.
//
// One area at a time, not both concatenated. A file staged and then edited again appears in both
// groups, and the row model keys a file by its path alone, so a combined stack would hold two files
// claiming the same identity and the second would win. Which area is on screen is visible: it is the
// group the highlighted row sits in.
export function stackFor(groups: ChangesGroups, selected: LocalChange | null): LocalChange[] {
  if (!selected) return []
  return selected.staged ? groups.staged : groups.unstaged
}

// Keep the current selection while it still exists, else fall back to the first unstaged change.
//
// Unstaged first, even though the staged group renders above it, because this also picks which
// staging area the diff column stacks. Staging is deliberate and usually the last thing before a
// commit, so one staged file should not hide twenty unstaged ones from a reader who has not clicked
// anything yet. It falls through to staged when the working tree is clean.
export function pickSelected(groups: ChangesGroups, selectedKey: string | null): LocalChange | null {
  const all = [...groups.staged, ...groups.unstaged]
  if (selectedKey) {
    const kept = all.find((c) => changeKey(c) === selectedKey)
    if (kept) return kept
  }
  return groups.unstaged[0] ?? groups.staged[0] ?? null
}

// Local change + patch → the DiffFile shape the diff model consumes.
//
// `sha` carries the staging area rather than a blob hash. The viewer never reads it; it hands it
// straight back through DiffSource.fileText, which is how a gap gets filled, and for a working tree
// "which side" is the staging area (the index for staged, the file on disk for unstaged). It stays
// null for a deletion, which is how the viewer knows to draw that file's gaps inert: there is no new
// side of a file that is gone.
export function toPullFile(change: LocalChange, patch: string | null): DiffFile {
  return {
    path: change.path,
    status: change.status === 'untracked' ? 'added' : change.status,
    additions: change.additions,
    deletions: change.deletions,
    sha: change.status === 'deleted' ? null : change.staged ? 'staged' : 'unstaged',
    viewed: false,
    patch,
  }
}
