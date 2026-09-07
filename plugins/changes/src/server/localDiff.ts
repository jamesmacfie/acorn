// Local diff source for uncommitted changes. Parses `git status --porcelain=v2` into unified patches
// per file and scope, plus blob reads, all against a task's worktree. Patches carry only hunks, like
// GitHub's per-file patch, so the client's diff.ts synth and gitdiff-parser path handle them
// unchanged. Every git call uses execFile with an argument array, and repo-relative paths are
// validated at this boundary: no `..` segments, no absolute paths.

import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { git, gitOrThrow, gitText, invalidateWorktreeStatus, worktreeStatusText } from '@acorn/plugin-api/node'
import type { LocalChange, LocalStatus } from '@acorn/protocol/terminal.ts'
import type { CommitOptions, HeadCommit, PullOptions, PushOptions } from '../shared/api'


export type { LocalChange, LocalStatus } from '@acorn/protocol/terminal.ts'
type LocalChangeStatus = LocalChange['status']

export type LocalScope = 'unstaged' | 'staged'

// Repo-relative only: rejects absolute paths, `..` segments, and a leading dash, which argv could
// mistake for a flag.
export const isValidRelPath = (p: string): boolean =>
  typeof p === 'string' && !!p && !p.startsWith('/') && !p.startsWith('-') && !p.split('/').includes('..') && !p.includes('\0')

const statusFor = (xy: string, index: boolean): LocalChangeStatus => {
  const c = index ? xy[0] : xy[1]
  if (c === 'A') return 'added'
  if (c === 'D') return 'deleted'
  if (c === 'R' || c === 'C') return 'renamed'
  return 'modified'
}

/** What `--porcelain=v2 --branch` says before the entries, plus the entries. `operation` is not here
 *  because it is a filesystem question rather than a line of this output. */
export type ParsedPorcelain = Omit<LocalStatus, 'operation'>

// Pure parser for `git status --porcelain=v2 --branch` output taken without `-z`, so git C-quotes
// unusual paths and this accepts them as-is. A file changed in both the index and the worktree yields
// two entries, one per scope, matching the staged and unstaged groups the pane shows.
//
// The four `# branch.*` headers come back too. `branch.upstream` and `branch.ab` are absent when the
// branch has no upstream, which is why `upstream`, `ahead` and `behind` are null rather than zero
// there: "nothing to count against" and "level with the remote" are different answers and the remote
// bar says different things about them.
export function parsePorcelainV2(stdout: string): ParsedPorcelain {
  const lines = stdout.split('\n')
  const header = (key: string): string | null =>
    lines.find((line) => line.startsWith(`# ${key} `))?.slice(key.length + 3).trim() ?? null
  const head = header('branch.head')
  // `+A -B`, in that order and always both.
  const ab = header('branch.ab')?.match(/^\+(\d+) -(\d+)$/)
  const out: LocalChange[] = []
  for (const line of lines) {
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
      // Unmerged. Its own status, not a modification: git's answer to "stage it" is "mark it
      // resolved", and there is no half of it that can be in the index while the rest is not.
      const path = parts.slice(10).join(' ')
      out.push({ path, status: 'conflicted', staged: false, additions: null, deletions: null })
    }
  }
  return {
    branch: head === '(detached)' ? null : head,
    upstream: header('branch.upstream'),
    ahead: ab ? Number(ab[1]) : null,
    behind: ab ? Number(ab[2]) : null,
    changes: out,
  }
}

// Pure: merge numstat (adds/dels per path) into changes for one scope.
export function mergeNumstat(changes: LocalChange[], numstat: string, staged: boolean): LocalChange[] {
  const stats = new Map<string, { a: number | null; d: number | null }>()
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [a, d, ...rest] = line.split('\t')
    const path = rest.join('\t')
    // A rename shows as "old => new" in the numstat path field only with -M; keep the raw path as
    // the map key either way.
    stats.set(path, { a: a === '-' ? null : Number(a), d: d === '-' ? null : Number(d) })
  }
  return changes.map((c) => {
    if (c.staged !== staged) return c
    // A conflicted file is in neither diff, and `git diff --numstat` reports the merge markers as
    // changed lines if it is asked. The row says "conflicted" and no count at all.
    if (c.status === 'conflicted') return c
    const s = stats.get(c.path) ?? (c.oldPath ? stats.get(`${c.oldPath} => ${c.path}`) : undefined)
    return s ? { ...c, additions: s.a, deletions: s.d } : c
  })
}

// Is a merge or a rebase mid-flight? A stat rather than a git call, and not against
// `<worktree>/.git`, which in a worktree is a file pointing at the shared repository's
// `worktrees/<name>` directory. That directory is where these three live, so `rev-parse --git-dir`
// is the only way to find them.
export async function gitOperation(worktree: string): Promise<LocalStatus['operation']> {
  const dir = await gitText(['rev-parse', '--git-dir'], { cwd: worktree, timeoutMs: 10_000 }).catch(() => '')
  if (!dir) return null
  const gitDir = isAbsolute(dir) ? dir : join(worktree, dir)
  const present = async (name: string) => await lstat(join(gitDir, name)).then(() => true, () => false)
  if (await present('MERGE_HEAD')) return 'merge'
  // Two names, one operation: `rebase-merge` is the interactive and merge-based rebase, `rebase-apply`
  // the am-based one.
  if ((await present('rebase-merge')) || (await present('rebase-apply'))) return 'rebase'
  return null
}

// Everything the pane draws, from one status read. Every later region of the panel — the totals, the
// groups, the branch bar — reads this record rather than asking git a second question, because two
// reads a poll interval apart disagree and the reader sees the disagreement.
export async function localStatus(worktree: string): Promise<LocalStatus> {
  // The shared status read, not a fourth `git status` for the same directory. Core's rail markers ask
  // the same question of the same path, so both take whichever process ran in the last two seconds
  // (@acorn/plugin-api/node § worktreeStatusText). Core reads two of the `--branch` headers and this
  // reads four, which is why the two callers can share one command.
  const stdout = (await worktreeStatusText(worktree)) ?? ''
  const parsed = parsePorcelainV2(stdout)
  let changes = parsed.changes
  try {
    const [unstaged, staged] = await Promise.all([
      gitText(['diff', '--numstat'], { cwd: worktree, timeoutMs: 15_000 }),
      gitText(['diff', '--staged', '--numstat'], { cwd: worktree, timeoutMs: 15_000 }),
    ])
    changes = mergeNumstat(mergeNumstat(changes, unstaged, false), staged, true)
  } catch {
    // Stats are decoration. The list still renders without them.
  }
  return { ...parsed, changes, operation: await gitOperation(worktree) }
}

// Everything before the first hunk header is git's file header. The client re-synthesizes its
// own (client diff.ts synth), so this emits hunks-only, like GitHub's per-file patch.
export const stripToHunks = (patch: string): string => {
  const i = patch.indexOf('\n@@')
  if (patch.startsWith('@@')) return patch
  return i < 0 ? '' : patch.slice(i + 1)
}

// Git's default -U3 for both callers: the pane wants hunks with expandable gaps between them, and the
// MCP tool wants them for the tokens. The pane used to ask for a huge -U to get a whole-file view,
// which made every change harder to find, not easier.
export async function localDiff(worktree: string, path: string, scope: LocalScope): Promise<{ patch: string }> {
  if (!isValidRelPath(path)) throw new Error('Invalid path.')
  // Untracked files aren't in the index, so this renders an all-additions patch via --no-index.
  const tracked = (await git(['ls-files', '--error-unmatch', '--', path], { cwd: worktree, timeoutMs: 10_000 })).code === 0
  if (!tracked && scope === 'unstaged') {
    // --no-index exits 1 on "differences found", which counts as success for a diff. The broker
    // returns the exit code as data, so this needs no catch that inspects an exec error's shape.
    const result = await git(['diff', '--no-index', '--', '/dev/null', path], { cwd: worktree, timeoutMs: 15_000 })
    if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr.trim() || 'git diff failed')
    return { patch: stripToHunks(result.stdout) }
  }
  const args = ['diff', ...(scope === 'staged' ? ['--staged'] : []), '--', path]
  // gitOrThrow, not gitText: a patch is content, and gitText trims.
  const { stdout } = await gitOrThrow(args, { cwd: worktree, timeoutMs: 15_000 })
  return { patch: stripToHunks(stdout) }
}

// Stage, commit and discard: one-line git calls so the pane can land the work it reviewed. Stops
// here. No hunk staging, no rebase UI.

export type GitActionResult = { ok: true } | { ok: false; reason: string }

/** How long a git command that talks to a remote is given. Four times the local budget below,
 *  because the clock is somebody else's server and a slow fetch is not a wedged one. Nothing waits
 *  forever: `GIT_TERMINAL_PROMPT=0` in the git seam turns expired credentials into a fast failure
 *  rather than a blocked prompt (`packages/node-core/src/server/core/git.ts`). */
export const NETWORK_TIMEOUT_MS = 120_000

const run = async (worktree: string, args: string[], timeoutMs = 30_000): Promise<GitActionResult> => {
  // Every mutation this file makes goes through here, which makes it the one place that has to drop the
  // coalesced `git status` for the path. Before the command, not after: a status read that starts while
  // `git add` is running must not be able to store its pre-stage answer under the new timestamp
  // (@acorn/plugin-api/node § worktreeStatusText).
  //
  // A fetch touches no file in the worktree and still belongs here: it moves the behind count, which
  // the panel reads out of the same coalesced status.
  invalidateWorktreeStatus(worktree)
  const result = await git(args, { cwd: worktree, timeoutMs })
  invalidateWorktreeStatus(worktree)
  if (result.spawnError) return { ok: false, reason: result.spawnError }
  if (result.timedOut) return { ok: false, reason: 'git timed out' }
  if (result.code !== 0) return { ok: false, reason: (result.stderr || 'git failed').trim().slice(0, 400) }
  return { ok: true }
}

/** How many paths ride on one git call. A folder checkbox over a large tree can name thousands, and
 *  argv has a length limit; 200 repo-relative paths is a few kilobytes whatever they are called. */
export const STAGE_CHUNK = 200

/** Pure: the batches one staging action turns into. Exported for the test that pins the size, since
 *  the count of git calls is the whole behaviour. */
export function pathChunks(paths: readonly string[], size = STAGE_CHUNK): string[][] {
  const out: string[][] = []
  for (let at = 0; at < paths.length; at += size) out.push([...paths.slice(at, at + size)])
  return out
}

// One call per batch, stopping at the first failure so the reason the pane shows is the one git gave.
const runChunked = async (worktree: string, paths: readonly string[], args: string[], size: number): Promise<GitActionResult> => {
  if (!paths.length) return { ok: false, reason: 'No paths.' }
  if (!paths.every(isValidRelPath)) return { ok: false, reason: 'Invalid path.' }
  for (const chunk of pathChunks(paths, size)) {
    const result = await run(worktree, [...args, '--', ...chunk])
    if (!result.ok) return result
  }
  return { ok: true }
}

// Staging takes a list, not a path: a row's checkbox sends one and a group's or a folder's sends many,
// and one shape for both is what keeps the pane from looping over a per-file route.
export function stageFiles(worktree: string, paths: readonly string[], size = STAGE_CHUNK): Promise<GitActionResult> {
  return runChunked(worktree, paths, ['add'], size)
}

export function unstageFiles(worktree: string, paths: readonly string[], size = STAGE_CHUNK): Promise<GitActionResult> {
  return runChunked(worktree, paths, ['restore', '--staged'], size)
}

// Discard restores the worktree copy. It is destructive, so the caller must confirm first.
// Untracked files aren't restorable; delete them via git clean, scoped to the one path.
export async function discardFile(worktree: string, path: string, untracked: boolean): Promise<GitActionResult> {
  if (!isValidRelPath(path)) return { ok: false, reason: 'Invalid path.' }
  return untracked ? run(worktree, ['clean', '-f', '--', path]) : run(worktree, ['restore', '--', path])
}

// Bulk variants for the ChangesPane toolbar: the whole working tree at once.
export const stageAll = (worktree: string): Promise<GitActionResult> => run(worktree, ['add', '-A'])
export const unstageAll = (worktree: string): Promise<GitActionResult> => run(worktree, ['reset'])
// Discard everything. Destructive, so the caller must confirm first: drops staged, unstaged, and
// untracked files.
export async function discardAll(worktree: string): Promise<GitActionResult> {
  const reset = await run(worktree, ['reset', '--hard'])
  return reset.ok ? run(worktree, ['clean', '-fd']) : reset
}

/** The argv one commit turns into. Exported so the order is a table test rather than a reading of
 *  the function: git accepts these flags in any order, and a test that pins one is the only way a
 *  reader can tell which one they will see in a log. */
export function commitArgs(message: string, options: CommitOptions = {}): string[] {
  return [
    'commit',
    ...(options.all ? ['-a'] : []),
    ...(options.amend ? ['--amend'] : []),
    ...(options.signoff ? ['--signoff'] : []),
    ...(options.noVerify ? ['--no-verify'] : []),
    '-m',
    message,
  ]
}

// Commit what the options name: the index, or every tracked change when `all` is set. `--` never
// applies, because -m is fixed and the message is a value argv.
export async function commitStaged(worktree: string, message: string, options: CommitOptions = {}): Promise<GitActionResult> {
  const msg = message.trim()
  // Refused here rather than by git, which would answer with its own commit-template help text. An
  // amend with no message is still a message: the client fills the field from HEAD before it asks.
  if (!msg) return { ok: false, reason: 'Commit message required.' }
  return run(worktree, commitArgs(msg, options))
}

/** HEAD's hash and full message, for the field an amend fills. Null on a branch with no commits yet,
 *  where `git log` fails rather than answering nothing. */
export async function headCommit(worktree: string): Promise<HeadCommit | null> {
  // gitOrThrow, not gitText: a commit message is content, and its body's blank lines are part of it.
  // The unit separator keeps the split honest for a subject that contains one of anything else.
  const { stdout } = await gitOrThrow(['log', '-1', '--pretty=%H%x1f%B'], { cwd: worktree, timeoutMs: 15_000 }).catch(() => ({ stdout: '' }))
  const [sha, message] = stdout.split('\x1f')
  if (!sha?.trim()) return null
  // Trailing newlines only: git ends the body with one, and leading whitespace in a message is the
  // author's.
  return { sha: sha.trim(), message: (message ?? '').replace(/\n+$/, '') }
}

/** The branch a hook payload names. Empty on a detached head, which is a real answer: a handler
 *  keyed on branch names has nothing to say about one that has none. */
export async function branchOf(worktree: string): Promise<string> {
  const branch = await gitText(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktree, timeoutMs: 15_000 }).catch(() => '')
  return branch === 'HEAD' ? '' : branch
}

/** The argv each remote verb turns into. Pure and exported for the same reason `commitArgs` is: git
 *  takes most of these in any order, and a table test is the only way a reader can tell which line
 *  they will find in a shell history. */
export function pullArgs(options: PullOptions = {}): string[] {
  // Fast-forward only unless the reader asked for the rebase. A bare Pull is then safe to press
  // without reading: on a diverged branch git refuses and says so, where the default merge would
  // have written a merge commit nobody asked for.
  return ['pull', options.rebase ? '--rebase' : '--ff-only']
}

export function pushArgs(options: PushOptions = {}): string[] {
  // `--force-with-lease` with no argument compares the remote ref against this node's
  // remote-tracking ref, so a commit somebody else pushed since the last fetch makes the push fail
  // with a reason instead of dropping their work. Never a bare `--force`
  // (docs/security.md § Process, path, and configuration controls).
  //
  // `--set-upstream` on every push, not only the first: it is harmless where the upstream is already
  // set, and it means a branch whose upstream was deleted republishes without a second verb. That is
  // also why Publish and Push are one call with two labels.
  return ['push', ...(options.force ? ['--force-with-lease'] : []), '--set-upstream', 'origin', 'HEAD']
}

/** Undo whichever operation is mid-flight. The operation is read off the tree rather than taken
 *  from the caller: `merge` and `rebase` are argv, and a subcommand chosen over HTTP is a subcommand
 *  the panel cannot vouch for. */
export const abortArgs = (operation: 'merge' | 'rebase'): string[] => [operation, '--abort']

export const fetchRemote = (worktree: string): Promise<GitActionResult> =>
  run(worktree, ['fetch'], NETWORK_TIMEOUT_MS)

export const pullRemote = (worktree: string, options: PullOptions = {}): Promise<GitActionResult> =>
  run(worktree, pullArgs(options), NETWORK_TIMEOUT_MS)

export const pushBranch = (worktree: string, options: PushOptions = {}): Promise<GitActionResult> =>
  run(worktree, pushArgs(options), NETWORK_TIMEOUT_MS)

export const abortOperation = (worktree: string, operation: 'merge' | 'rebase'): Promise<GitActionResult> =>
  run(worktree, abortArgs(operation))

/** The diff a commit would take, over the paths named, as one patch.
 *
 *  For the prompt behind the commit editor's wand (./commitMessage.ts), which splits the answer back
 *  apart per file. One call for the whole set rather than `localDiff` per path: the caller has
 *  already bounded which paths it wants, and a spawn per file over a hundred small files is a hundred
 *  spawns to build one prompt.
 *
 *  Every path is validated here as everywhere else in this file, and an empty list answers an empty
 *  patch rather than running `git diff` with nothing after the `--`, which would diff the whole tree. */
export async function commitDiffText(worktree: string, staged: boolean, paths: readonly string[]): Promise<string> {
  if (!paths.length) return ''
  for (const path of paths) if (!isValidRelPath(path)) throw new Error('Invalid path.')
  const args = ['diff', ...(staged ? ['--staged'] : []), '--', ...paths]
  // gitOrThrow, not gitText: a patch is content, and leading whitespace on a context line is part of
  // it. The budget is the caller's, so the timeout is the local one.
  const { stdout } = await gitOrThrow(args, { cwd: worktree, timeoutMs: 30_000 }).catch(() => ({ stdout: '' }))
  return stdout
}

// Recent commits on the branch, for the MCP git_log tool.
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

// The new side of a file's diff, whole, so the pane can fill a gap the reader expands. Two sources,
// one per scope: the index for a staged diff, and the file on disk for an unstaged one. That second
// case is why this is not just another ref — `git show` reads objects, and the new side of an
// unstaged diff has never been written to one.
export async function localNewSideText(worktree: string, path: string, scope: LocalScope): Promise<{ text: string }> {
  if (!isValidRelPath(path)) throw new Error('Invalid path.')
  if (scope === 'staged') {
    // `:path` is the index entry. gitOrThrow, not gitText: a file body must be byte-exact, trailing
    // newline included.
    const { stdout } = await gitOrThrow(['show', `:${path}`], { cwd: worktree, timeoutMs: 15_000 })
    return { text: stdout }
  }
  // isValidRelPath already makes the join unescapable by path syntax. The resolve and the lstat cover
  // what it cannot: a symlink inside the worktree pointing anywhere it likes, on a path that arrived
  // over HTTP.
  const full = resolve(join(worktree, path))
  const root = resolve(worktree)
  if (full !== root && !full.startsWith(root + '/')) throw new Error('Invalid path.')
  const stat = await lstat(full)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular file.')
  return { text: await readFile(full, 'utf8') }
}
