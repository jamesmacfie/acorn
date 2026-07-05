// ChangesPane model (docs/panes.md): pure grouping/ordering/selection over LocalChange[] and the
// adapter that feeds a local patch into the existing PR diff pipeline (PullFile shape → diff.ts).
import type { PullFile } from '../../../shared/api'
import type { LocalChange } from '../../../shared/terminal'

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

// Keep the current selection while it still exists, else fall back to the first row
// (staged group first — it renders on top).
export function pickSelected(groups: ChangesGroups, selectedKey: string | null): LocalChange | null {
  const all = [...groups.staged, ...groups.unstaged]
  if (selectedKey) {
    const kept = all.find((c) => changeKey(c) === selectedKey)
    if (kept) return kept
  }
  return all[0] ?? null
}

// Local change + patch → the PullFile shape the diff model consumes (sha stays null: gap expansion
// needs a blob source; the local pane re-reads on demand instead).
export function toPullFile(change: LocalChange, patch: string | null): PullFile {
  return {
    path: change.path,
    status: change.status === 'untracked' ? 'added' : change.status,
    additions: change.additions,
    deletions: change.deletions,
    sha: null,
    viewed: false,
    patch,
  }
}
