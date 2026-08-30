// Find-in-files: project-wide text search over the task's worktree, backed by ripgrep. Keyed by
// taskId, not path: the client never hands over a path, so this resolves taskId to taskRoot and
// runs rg with cwd:root, searching `.`. Exposed as the SearchBridge (server/routes/search.ts).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rgPath } from '@vscode/ripgrep'
import type { SearchBridge, SearchOpts } from '../server/routes/search'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { FileHits, SearchResult } from '../shared/search'

// Only the task-to-worktree resolution, from core, which owns `tasks`. This plugin owns no tables
// (docs/data-layer.md § Plugin databases).
export type SearchCoreServices = Pick<CoreServices, 'tasks'>

const MAX_TOTAL_HITS = 2000 // Bound the response; the pane reports when results are truncated.
const MAX_PREVIEW_LEN = 300 // Keep one long or minified line from bloating the response payload.

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

// ripgrep's submatch offsets are UTF-8 bytes, while JavaScript strings and editor columns use UTF-16
// code units. Convert on the node so every client consumer shares one column
// contract. rg only reports code-point boundaries, so a partial character cannot occur, and the >=
// check clamps a malformed offset to the next valid position.
function utf16OffsetAtUtf8Byte(text: string, byteOffset: number): number {
  let bytes = 0
  let utf16 = 0
  for (const char of text) {
    if (bytes >= byteOffset) break
    bytes += Buffer.byteLength(char, 'utf8')
    utf16 += char.length
  }
  return utf16
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
      continue // non-JSON noise, skip defensively
    }
    if (ev.type === 'begin') {
      const raw = ev.data?.path?.text
      // Strip rg's `./` prefix (from searching path `.`) so paths match the git-ls-files-relative
      // form the tree, editor tabs, and editorOpen use. Otherwise a hit opens a mismatched tab.
      const path = raw?.startsWith('./') ? raw.slice(2) : raw
      current = path ? { path, hits: [] } : null // no text = non-UTF8 filename; skip the file
      if (current) files.push(current)
    } else if (ev.type === 'match' && current) {
      const line = ev.data?.line_number
      const text = ev.data?.lines?.text
      if (line == null || text == null) continue // bytes payload (non-UTF8 line), skip
      const content = text.replace(/\r?\n$/, '')
      const preview = content.slice(0, MAX_PREVIEW_LEN)
      for (const sm of ev.data?.submatches ?? []) {
        if (total >= MAX_TOTAL_HITS) {
          truncated = true
          break
        }
        current.hits.push({
          line,
          col: utf16OffsetAtUtf8Byte(content, sm.start) + 1,
          endCol: utf16OffsetAtUtf8Byte(content, sm.end) + 1,
          preview,
        })
        total++
      }
      if (truncated) break
    }
  }
  // Drop any file whose matches all fell past the cap (its begin ran but no hit landed).
  return { files: files.filter((f) => f.hits.length), truncated }
}

// Run ripgrep over the task's worktree. An unknown task or unmapped repo returns an empty result
// rather than an error: the taskId is the capability, and a stale one is benign.
export async function searchInFiles(core: SearchCoreServices, taskId: string, query: string, opts: SearchOpts): Promise<SearchResult> {
  const root = await core.tasks.root(taskId)
  if (!root || !query) return { files: [], truncated: false }
  // --json avoids path:line:text colon ambiguity. rg already honours .gitignore and skips
  // binary/hidden files, the same set editor:files offers. --no-config keeps a user's
  // RIPGREP_CONFIG_PATH from changing the flags this depends on.
  const args = ['--json', '--no-config']
  if (!opts.regex) args.push('--fixed-strings')
  if (!opts.caseSensitive) args.push('--ignore-case')
  if (opts.wholeWord) args.push('--word-regexp')
  // The trailing `.` is required: with no path argument and stdin not a TTY (execFile pipes it),
  // rg blocks reading stdin forever and only dies at the timeout. `.` means search the cwd, the
  // worktree.
  args.push('--', query, '.')
  const { stdout } = await promisify(execFile)(rgPath, args, {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 32 * 1024 * 1024,
  }).catch(() => ({ stdout: '' })) // rg exits 1 on no-match / 2 on bad regex → empty result
  return parseRgJson(stdout)
}

export const searchBridge = (core: SearchCoreServices): SearchBridge => ({
  findInFiles: (taskId, query, opts) => searchInFiles(core, taskId, query, opts),
})
