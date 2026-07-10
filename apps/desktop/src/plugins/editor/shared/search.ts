// Shared types for the find-in-files feature (docs/panes.md): the Search pane POSTs to the
// searchRoute (server/routes/search.ts), whose SearchBridge (main/search.ts) runs ripgrep against
// the task's worktree. Types live here so main + renderer stay in lockstep, like shared/terminal.ts.

export type SearchOpts = {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

// One match within a file. `col`/`endCol` are 1-based columns into `preview` for highlighting.
// ponytail: cols are byte offsets from ripgrep; equal to UTF-16 columns for ASCII. Convert only if
// multibyte highlighting misaligns.
export type SearchHit = {
  line: number
  col: number
  endCol: number
  preview: string
}

// Matches grouped by worktree-relative file path (ripgrep emits them file-by-file already).
export type FileHits = {
  path: string
  hits: SearchHit[]
}

export type SearchResult = {
  files: FileHits[]
  truncated: boolean // hit the total-match cap — the pane shows a "results truncated" note
}
