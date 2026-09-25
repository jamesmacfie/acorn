// Local Git change wire contracts.
// Local-changes review (docs/panes.md): one working-tree change as the ChangesPane sees it.
// A file changed in both the index and the worktree appears once per scope (staged flag).
// `conflicted` is git's unmerged state: it is never staged, has no line counts, and staging it is how
// git marks the conflict resolved.
export type LocalChange = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
  oldPath?: string // for renames
  staged: boolean
  additions: number | null
  deletions: number | null
  // Moves whenever this entry's patch could have moved, so a reader holding the patch knows whether to
  // read it again. The modes and objects git reports for the HEAD and index sides, plus a stat of the
  // file on disk for the working-tree side, which git has not hashed. Optional: an older node does not
  // send it, and a submodule, whose new commit git does not report, has none.
  contentKey?: string
}

// Everything the Changes pane draws, from one `git status --porcelain=v2 --branch` read. Two reads
// would disagree for a poll interval, so the branch facts travel with the file list rather than beside
// it (docs/diff-rendering.md § Data flow).
export type LocalStatus = {
  branch: string | null // null on a detached HEAD
  upstream: string | null // null when the branch has no upstream
  ahead: number | null // null, not zero, when there is no upstream to count against
  behind: number | null
  operation: 'merge' | 'rebase' | null // a merge or rebase is mid-flight
  changes: LocalChange[]
}
