// One `git status` per worktree per two seconds, however many callers ask. The changes pane's other
// reads of the same tree, its line counts and where the git directory is, share the same window
// through `worktreeGitText`.
//
// Before this, a status ping spawned `git status --porcelain=v2` plus two `git diff --numstat` in the
// changes plugin's local-changes read, and `worktrees.ts` spawned a second and third `git status` for
// the same worktree from a different caller. Every connected client asked independently, so two
// clients and four worktrees was twelve processes per ping.
//
// Built on the dedup shape server/sync/engine.ts already uses for provider mirrors: an in-flight map
// so concurrent callers join one run, and a time-to-live so a caller just behind one gets the answer
// that run produced. What it deliberately is not is a filesystem watcher — refused, with its exit
// condition, in docs/workspaces-and-tasks.md § Worktree status reads.
//
// ── The one rule ──────────────────────────────────────────────────────────────────────────────────
//
// **This cache serves reads. It never serves a refusal.** `removeWorktree` in ./worktrees.ts refuses
// to delete a worktree with uncommitted changes, and a stale "clean" would let that deletion past the
// guard and lose somebody's work. So `worktreeDirty` and every other path that decides whether to
// refuse passes `fresh: true`, which skips the in-flight promise and the time-to-live and runs git.
// `worktreeStatus.test.ts` holds the test that says so: a file written 100 ms ago still blocks a
// removal without `force`.
import { gitOrThrow } from '../core/git'

/** How long a read is answered from the last run. Short enough that a change made outside acorn shows
 *  up on the next client tick, long enough that a ping from every connected client costs one process. */
export const WORKTREE_STATUS_TTL_MS = 2_000

export type WorktreeStatus = { dirty: boolean; count: number; branch: string | null; head: string | null }

// One remembered read per worktree path and argument list. Keyed by path first so a write under the
// path drops every read of it at once, the status and the changes pane's line counts together.
type Read = { text: string | null; at: number; running: Promise<string | null> | null }
const reads = new Map<string, Map<string, Read>>()

const run = async (path: string, args: readonly string[], timeoutMs: number): Promise<string | null> => {
  try {
    return (await gitOrThrow(args, { cwd: path, timeoutMs })).stdout
  } catch {
    return null
  }
}

/** The raw stdout of a read-only git command in a worktree, shared the way the status read is:
 *  concurrent callers join the run in flight, a caller inside the window gets what that run printed,
 *  and `invalidateWorktreeStatus(path)` drops it along with the status. Null when git could not answer,
 *  and a failure is never remembered.
 *
 *  Reads only, and only reads whose answer moves when a file under the worktree moves: the node's own
 *  writers invalidate on exactly that, and nothing else. The changes pane's `git diff --numstat` pair
 *  and its `rev-parse --git-dir` come through here; before, two clients on one task cost four
 *  numstat processes a poll where the status beside them cost one. */
export async function worktreeGitText(path: string, args: readonly string[], opts: { fresh?: boolean; timeoutMs?: number } = {}): Promise<string | null> {
  const key = args.join('\0')
  const known = reads.get(path)?.get(key)
  if (known && !opts.fresh) {
    if (known.text !== null && Date.now() - known.at < WORKTREE_STATUS_TTL_MS) return known.text
    if (known.running) return known.running
  }
  // A `fresh` read still shares its answer with whoever asks next: it is the newest truth there is.
  // What it does not do is *join* one, which is the half that matters for the removal guard.
  const read: Read = { text: null, at: 0, running: null }
  read.running = run(path, args, opts.timeoutMs ?? 10_000).then((text) => {
    read.running = null
    if (text !== null) {
      read.text = text
      read.at = Date.now()
    }
    return text
  })
  let forPath = reads.get(path)
  if (!forPath) reads.set(path, (forPath = new Map()))
  forPath.set(key, read)
  return read.running
}

// `--porcelain=v2 --branch` adds `# branch.oid` and `# branch.head` header lines ahead of the entries,
// so one process answers "is it dirty", "how many files" and "where is HEAD"
// (docs/plugins.md § Hearing a core event § HEAD moved). The changes plugin's own parser skips any
// line that does not start with `?`, `1`, `2` or `u`, so the headers cost it nothing and the two
// callers share one process rather than spawning one each.
//
// `--untracked-files=all` because git's default collapses a wholly untracked directory to one entry
// named `dir/`, and the changes pane can do nothing with that: there is no file to diff and no file
// to discard. Ignored directories are still skipped, so the extra walk is over files somebody is
// about to be asked about anyway.
const STATUS_ARGS = ['status', '--porcelain=v2', '--branch', '--untracked-files=all']

/** The raw `git status --porcelain=v2 --branch` output for a worktree, or null when git could not
 *  answer (the directory is gone, it is not a worktree, git timed out).
 *
 *  A failure is never cached: "we could not tell" must not become "clean" for the next two seconds. */
export async function worktreeStatusText(path: string, opts?: { fresh?: boolean }): Promise<string | null> {
  return await worktreeGitText(path, STATUS_ARGS, { fresh: opts?.fresh, timeoutMs: 10_000 })
}

/** Pure parser, so the shape is testable without a repo. `branch` is null on a detached HEAD, `head`
 *  null when the tree is unborn. */
export function parseWorktreeStatus(text: string): WorktreeStatus {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const header = (key: string) => lines.find((l) => l.startsWith(`# ${key} `))?.slice(key.length + 3).trim() ?? null
  const count = lines.filter((l) => !l.startsWith('#')).length
  const branch = header('branch.head')
  const head = header('branch.oid')
  return { dirty: count > 0, count, branch: branch === '(detached)' ? null : branch, head: head === '(initial)' ? null : head }
}

/** Dirty flag, changed-file count and where HEAD is, for the rail and footer markers
 *  (docs/workspaces-and-tasks.md). Pass `fresh: true` from anything that decides whether to refuse. */
export async function worktreeStatus(path: string, opts?: { fresh?: boolean }): Promise<WorktreeStatus> {
  const text = await worktreeStatusText(path, opts)
  // Git could not answer. Reported as clean-and-unknown, which is what both callers did before this
  // file existed; the removal guard is safe because it reads `dirty` from a `fresh` run and a
  // directory git cannot see is a directory `git worktree remove` will refuse on its own.
  return text === null ? { dirty: false, count: 0, branch: null, head: null } : parseWorktreeStatus(text)
}

/** Drop what we remember about a path, because this node just wrote under it. Called by the worktree
 *  writers (create, remove) and by the plugin seam `ctx.events.worktreeStatus` reaches. With no
 *  argument, drops everything, which is what a data-root switch wants.
 *
 *  A run already in flight is dropped too, not just a finished one: it may have started before the
 *  write, and a caller that asks after the write must not join it. The run still finishes, and its
 *  answer goes to the callers that were already waiting on it. */
export function invalidateWorktreeStatus(path?: string): void {
  if (path === undefined) {
    reads.clear()
    return
  }
  reads.delete(path)
}

/** Test seam: the maps are module singletons whose lifetime is the node's. */
export function _resetWorktreeStatus(): void {
  reads.clear()
}
