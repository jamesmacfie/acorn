// Local (uncommitted) diff source (docs/panes.md): parsed `git status --porcelain=v2`, unified
// patches per file/scope, and blob reads — all against a task's worktree. Patches are emitted as
// HUNKS-ONLY bodies (like GitHub's per-file `patch`), so the renderer's existing diff.ts/synth +
// gitdiff-parser path works unchanged. execFile with arg arrays only; repo-relative paths are
// validated at this boundary (reject `..`/absolute — the editor-IPC discipline).

import { git, gitOrThrow, gitText } from '@acorn/node-core/main/core/git.ts'
import type { LocalChange } from '@acorn/protocol/terminal.ts'


export type { LocalChange } from '@acorn/protocol/terminal.ts'
type LocalChangeStatus = LocalChange['status']

export type LocalScope = 'unstaged' | 'staged'

// Repo-relative only: no absolute paths, no `..` segments, no leading dash (argv guard).
export const isValidRelPath = (p: string): boolean =>
  typeof p === 'string' && !!p && !p.startsWith('/') && !p.startsWith('-') && !p.split('/').includes('..') && !p.includes('\0')

const statusFor = (xy: string, index: boolean): LocalChangeStatus => {
  const c = index ? xy[0] : xy[1]
  if (c === 'A') return 'added'
  if (c === 'D') return 'deleted'
  if (c === 'R' || c === 'C') return 'renamed'
  return 'modified'
}

// Pure parser for `git status --porcelain=v2` (no -z; git C-quotes exotic paths — accepted as-is).
// A file changed in BOTH index and worktree yields two entries (one per scope), mirroring the
// staged/unstaged groups the pane shows.
export function parsePorcelainV2(stdout: string): LocalChange[] {
  const out: LocalChange[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const kind = line[0]
    if (kind === '?') {
      out.push({ path: line.slice(2), status: 'untracked', staged: false, additions: null, deletions: null })
      continue
    }
    if (kind !== '1' && kind !== '2' && kind !== 'u') continue
    const parts = line.split(' ')
    const xy = parts[1] ?? '..'
    if (kind === '1') {
      const path = parts.slice(8).join(' ')
      if (xy[0] !== '.') out.push({ path, status: statusFor(xy, true), staged: true, additions: null, deletions: null })
      if (xy[1] !== '.') out.push({ path, status: statusFor(xy, false), staged: false, additions: null, deletions: null })
    } else if (kind === '2') {
      // `2 XY sub mH mI mW hH hI Xscore path\torigPath`
      const pathField = parts.slice(9).join(' ')
      const [path, origPath] = pathField.split('\t')
      if (xy[0] !== '.') out.push({ path, oldPath: origPath, status: statusFor(xy, true), staged: true, additions: null, deletions: null })
      if (xy[1] !== '.') out.push({ path, oldPath: origPath, status: statusFor(xy, false), staged: false, additions: null, deletions: null })
    } else {
      // unmerged — surface as an unstaged modification so the reviewer sees it
      const path = parts.slice(10).join(' ')
      out.push({ path, status: 'modified', staged: false, additions: null, deletions: null })
    }
  }
  return out
}

// Pure: merge numstat (adds/dels per path) into changes for one scope.
export function mergeNumstat(changes: LocalChange[], numstat: string, staged: boolean): LocalChange[] {
  const stats = new Map<string, { a: number | null; d: number | null }>()
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [a, d, ...rest] = line.split('\t')
    const path = rest.join('\t')
    // Renames appear as `old => new` or `{old => new}` in --numstat path; the tab-split form is `old\tnew`? git numstat uses "old => new" inline only with -M... keep the raw path key.
    stats.set(path, { a: a === '-' ? null : Number(a), d: d === '-' ? null : Number(d) })
  }
  return changes.map((c) => {
    if (c.staged !== staged) return c
    const s = stats.get(c.path) ?? (c.oldPath ? stats.get(`${c.oldPath} => ${c.path}`) : undefined)
    return s ? { ...c, additions: s.a, deletions: s.d } : c
  })
}

export async function localChanges(worktree: string): Promise<LocalChange[]> {
  const stdout = await gitText(['status', '--porcelain=v2'], { cwd: worktree, timeoutMs: 15_000 })
  let changes = parsePorcelainV2(stdout)
  try {
    const [unstaged, staged] = await Promise.all([
      gitText(['diff', '--numstat'], { cwd: worktree, timeoutMs: 15_000 }),
      gitText(['diff', '--staged', '--numstat'], { cwd: worktree, timeoutMs: 15_000 }),
    ])
    changes = mergeNumstat(mergeNumstat(changes, unstaged, false), staged, true)
  } catch {
    // stats are decoration — the list still renders
  }
  return changes
}

// Everything before the first hunk header is git's file header — the renderer re-synthesizes its
// own (client diff.ts synth), so emit hunks-only like GitHub's per-file patch.
export const stripToHunks = (patch: string): string => {
  const i = patch.indexOf('\n@@')
  if (patch.startsWith('@@')) return patch
  return i < 0 ? '' : patch.slice(i + 1)
}

// `context` sets git's -U: the ChangesPane passes a huge value for a whole-file view (no expand
// affordances), while the MCP tool keeps git's default (token-efficient hunks).
export async function localDiff(worktree: string, path: string, scope: LocalScope, context?: number): Promise<{ patch: string }> {
  if (!isValidRelPath(path)) throw new Error('Invalid path.')
  const ctx = context != null && Number.isInteger(context) && context >= 0 ? [`-U${context}`] : []
  // Untracked files aren't in the index: render an all-additions patch via --no-index (exits 1 on
  // "differences found" — that IS success for a diff).
  const tracked = (await git(['ls-files', '--error-unmatch', '--', path], { cwd: worktree, timeoutMs: 10_000 })).code === 0
  if (!tracked && scope === 'unstaged') {
    // --no-index exits 1 on "differences found", which IS success for a diff. The broker returns the
    // exit code as data, so this no longer needs a catch that inspects an exec error's shape.
    const result = await git(['diff', '--no-index', ...ctx, '--', '/dev/null', path], { cwd: worktree, timeoutMs: 15_000 })
    if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr.trim() || 'git diff failed')
    return { patch: stripToHunks(result.stdout) }
  }
  const args = ['diff', ...(scope === 'staged' ? ['--staged'] : []), ...ctx, '--', path]
  // gitOrThrow, not gitText: a patch is content, and gitText trims.
  const { stdout } = await gitOrThrow(args, { cwd: worktree, timeoutMs: 15_000 })
  return { patch: stripToHunks(stdout) }
}

// --- Stage/commit actions (docs/panes.md): one-line git calls; the pane can land the work it
// reviewed. Stops here per the doc — no hunk staging, no rebase UI. ---

export type GitActionResult = { ok: true } | { ok: false; reason: string }

const run = async (worktree: string, args: string[]): Promise<GitActionResult> => {
  const result = await git(args, { cwd: worktree, timeoutMs: 30_000 })
  if (result.spawnError) return { ok: false, reason: result.spawnError }
  if (result.timedOut) return { ok: false, reason: 'git timed out' }
  if (result.code !== 0) return { ok: false, reason: (result.stderr || 'git failed').trim().slice(0, 400) }
  return { ok: true }
}

export async function stageFile(worktree: string, path: string): Promise<GitActionResult> {
  if (!isValidRelPath(path)) return { ok: false, reason: 'Invalid path.' }
  return run(worktree, ['add', '--', path])
}

export async function unstageFile(worktree: string, path: string): Promise<GitActionResult> {
  if (!isValidRelPath(path)) return { ok: false, reason: 'Invalid path.' }
  return run(worktree, ['restore', '--staged', '--', path])
}

// Discard = restore the worktree copy (destructive — the caller MUST confirm first). Untracked
// files aren't restorable; delete them via git clean, scoped to the one path.
export async function discardFile(worktree: string, path: string, untracked: boolean): Promise<GitActionResult> {
  if (!isValidRelPath(path)) return { ok: false, reason: 'Invalid path.' }
  return untracked ? run(worktree, ['clean', '-f', '--', path]) : run(worktree, ['restore', '--', path])
}

// Bulk variants for the ChangesPane toolbar — the whole working tree at once.
export const stageAll = (worktree: string): Promise<GitActionResult> => run(worktree, ['add', '-A'])
export const unstageAll = (worktree: string): Promise<GitActionResult> => run(worktree, ['reset'])
// Discard everything (destructive — caller MUST confirm): drop staged+unstaged AND untracked files.
export async function discardAll(worktree: string): Promise<GitActionResult> {
  const reset = await run(worktree, ['reset', '--hard'])
  return reset.ok ? run(worktree, ['clean', '-fd']) : reset
}

// Commit whatever is staged. `--` never applies: -m is fixed and message is a value argv.
export async function commitStaged(worktree: string, message: string): Promise<GitActionResult> {
  const msg = message.trim()
  if (!msg) return { ok: false, reason: 'Commit message required.' }
  return run(worktree, ['commit', '-m', msg])
}

// Push HEAD to origin. `-u origin HEAD` works for the first push (sets upstream) and every
// push after (harmless re-affirm), so one command covers both — no upstream-detection round-trip.
// ponytail: origin only; add a remote picker if a multi-remote worktree ever shows up.
export async function pushBranch(worktree: string): Promise<GitActionResult> {
  return run(worktree, ['push', '--set-upstream', 'origin', 'HEAD'])
}

// Recent commits on the branch (the MCP git_log tool, docs/mcp.md).
export type GitLogEntry = { sha: string; subject: string; author: string; committedAt: number }

export function parseGitLog(stdout: string): GitLogEntry[] {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, author, ts] = line.split('\x1f')
      return { sha: sha ?? '', subject: subject ?? '', author: author ?? '', committedAt: Number(ts) * 1000 || 0 }
    })
    .filter((e) => e.sha)
}

export async function gitLog(worktree: string, n = 10): Promise<GitLogEntry[]> {
  const count = Number.isInteger(n) && n > 0 && n <= 100 ? n : 10
  const stdout = await gitText(['log', `-n${count}`, '--pretty=format:%h\x1f%s\x1f%an\x1f%ct'], { cwd: worktree, timeoutMs: 15_000 })
  return parseGitLog(stdout)
}

// Read a file's content at a ref (context expansion / before-side). ref is a commit-ish; guard the
// argv like resolveBaseRef does.
export async function localFileBlob(worktree: string, path: string, ref = 'HEAD'): Promise<{ text: string }> {
  if (!isValidRelPath(path)) throw new Error('Invalid path.')
  if (ref.startsWith('-') || ref.includes(':')) throw new Error('Invalid ref.')
  // gitOrThrow, not gitText: a file body must be byte-exact, trailing newline included.
  const { stdout } = await gitOrThrow(['show', `${ref}:${path}`], { cwd: worktree, timeoutMs: 15_000 })
  return { text: stdout }
}
