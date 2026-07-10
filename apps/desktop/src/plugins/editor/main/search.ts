// Find-in-files (docs/panes.md): project-wide text search over the task's worktree, backed by
// ripgrep. Keyed by taskId → taskRoot (the taskId is the capability; the renderer never hands us a
// path — rg runs with cwd:root and searches `.`), mirroring editor:files in localGitIpc.ts.
// Exposed as the SearchBridge (server/routes/search.ts); no longer an IPC channel (Phase 3).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rgPath } from '@vscode/ripgrep'
import type { SearchBridge, SearchOpts } from '../server/routes/search'
import type { AppDatabase } from '../../../core/server/db'
import type { FileHits, SearchResult } from '../shared/search'
import { taskRoot } from '../../../core/main/taskWorktree'

const MAX_TOTAL_HITS = 2000 // ponytail: fixed cap; the pane shows "truncated". Raise if it bites.
const MAX_PREVIEW_LEN = 300 // ponytail: clamp long lines so one minified file can't bloat the payload.

// One line of `rg --json` output. Only the fields we consume are typed; `type` discriminates.
type RgEvent = {
  type: 'begin' | 'end' | 'match' | 'summary' | 'context'
  data?: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number
    submatches?: { start: number; end: number }[]
  }
}

// Parse ripgrep's newline-delimited JSON into files→hits, capped at MAX_TOTAL_HITS total matches.
// rg emits matches file-by-file (begin → match* → end), so we group by consecutive path.
export function parseRgJson(stdout: string): SearchResult {
  const files: FileHits[] = []
  let current: FileHits | null = null
  let total = 0
  let truncated = false

  for (const raw of stdout.split('\n')) {
    if (!raw) continue
    let ev: RgEvent
    try {
      ev = JSON.parse(raw) as RgEvent
    } catch {
      continue // non-JSON noise — skip defensively
    }
    if (ev.type === 'begin') {
      const raw = ev.data?.path?.text
      // Strip rg's `./` prefix (from searching path `.`) so paths match the git-ls-files-relative
      // form the tree / editor tabs / editorOpen use — otherwise a hit opens a mismatched tab.
      const path = raw?.startsWith('./') ? raw.slice(2) : raw
      current = path ? { path, hits: [] } : null // no text = non-UTF8 filename; skip the file
      if (current) files.push(current)
    } else if (ev.type === 'match' && current) {
      const line = ev.data?.line_number
      const text = ev.data?.lines?.text
      if (line == null || text == null) continue // bytes payload (non-UTF8 line) — skip
      const preview = text.replace(/\r?\n$/, '').slice(0, MAX_PREVIEW_LEN)
      for (const sm of ev.data?.submatches ?? []) {
        if (total >= MAX_TOTAL_HITS) {
          truncated = true
          break
        }
        current.hits.push({ line, col: sm.start + 1, endCol: sm.end + 1, preview })
        total++
      }
      if (truncated) break
    }
  }
  // Drop any file whose matches all fell past the cap (its begin ran but no hit landed).
  return { files: files.filter((f) => f.hits.length), truncated }
}

// Run ripgrep over the task's worktree. Unknown task / unmapped repo → empty result (the pane just
// shows no hits), never an error — the taskId is the capability and a stale one is benign.
export async function searchInFiles(db: AppDatabase, taskId: string, query: string, opts: SearchOpts): Promise<SearchResult> {
  const root = await taskRoot(db, taskId)
  if (!root || !query) return { files: [], truncated: false }
  // --json: robust structured output (no path:line:text colon ambiguity). rg already honours
  // .gitignore and skips binary/hidden — the same set editor:files offers. --no-config so a
  // user's RIPGREP_CONFIG_PATH can't change the flags we depend on.
  const args = ['--json', '--no-config']
  if (!opts.regex) args.push('--fixed-strings')
  if (!opts.caseSensitive) args.push('--ignore-case')
  if (opts.wholeWord) args.push('--word-regexp')
  // The trailing `.` is REQUIRED: with no path arg and stdin not a TTY (execFile pipes it), rg
  // blocks reading stdin forever and only dies at the timeout. `.` = search cwd (the worktree).
  args.push('--', query, '.')
  const { stdout } = await promisify(execFile)(rgPath, args, {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 32 * 1024 * 1024,
  }).catch(() => ({ stdout: '' })) // rg exits 1 on no-match / 2 on bad regex → empty result
  return parseRgJson(stdout)
}

export const searchBridge = (db: AppDatabase): SearchBridge => ({
  findInFiles: (taskId, query, opts) => searchInFiles(db, taskId, query, opts),
})
