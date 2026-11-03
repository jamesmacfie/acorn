// Core task, worktree and archive wire contracts.
import { z } from 'zod'

// Result of archiving a task (docs/workspaces-and-tasks.md). `reason` carries the guard refusal
// (running sessions / dirty worktree) for the UI to surface. A failed teardown script sets
// teardownFailed so the UI can offer continue (re-archive with skipTeardown) or abort; `output` is the
// script's tail for display. `cleanupFailed` names the plugins whose opted-in cleanup threw. `ok` is
// still true: the task is archived, and reporting a failure would have the caller offering to retry
// something already done.
// `archivedTaskIds` includes descendants that finished, even when a later task refused archive.
export type ArchiveResult =
  | { ok: true; cleanupFailed?: string[]; archivedTaskIds?: string[] }
  | { ok: false; reason: string; teardownFailed?: boolean; output?: string; archivedTaskIds?: string[] }

// What the Node knows about an archive running in the background
// (docs/workspaces-and-tasks/background-archive.md). `none` means it holds no record: none was
// started, the Node restarted since, or the finished answer expired.
export type ArchiveRun = { state: 'running' } | { state: 'finished'; result: ArchiveResult } | { state: 'none' }

// The longest a client asks the Node to hold one wait open. It stays under the broker's 30-second
// request deadline, which is why archive runs in the background at all.
export const ARCHIVE_RUN_WAIT_MS = 20_000

const LOST_ARCHIVE =
  'The Node lost track of this archive, which happens when it restarts. If the task is still listed, archive it again.'

/** Archives in the background and waits for the outcome, so no one request outlives a client's deadline
 *  however long the teardown script runs. `start` answers null for a Node without the background routes,
 *  and `legacy` then archives in one request. Mixed-version path until 2027-02-02. */
export async function archiveInBackground(io: {
  start(): Promise<ArchiveRun | null>
  wait(): Promise<ArchiveRun>
  legacy(): Promise<ArchiveResult>
}): Promise<ArchiveResult> {
  let run = await io.start()
  if (!run) return io.legacy()
  while (run.state === 'running') run = await io.wait()
  return run.state === 'finished' ? run.result : { ok: false, reason: LOST_ARCHIVE }
}

export type ArchiveOpts = {
  deleteWorktree?: boolean
  force?: boolean
  skipTeardown?: boolean
  // Qualified concern ids whose checkbox the owner left ticked in the archive dialog. Matched against
  // the node's own task-check registry before anything runs, never treated as a route.
  applyChecks?: string[]
}

// `branchMissing` lets the caller offer a new branch when the archived task's local branch
// disappeared. A failed restore leaves the task archived.
export type RestoreResult = { ok: true } | { ok: false; reason: string; branchMissing?: boolean }

export type RestoreOpts = {
  newBranch?: boolean
}

// Result of deleting a task for good (docs/workspaces-and-tasks/archive.md § Deleting a task). An active
// task is archived first, so a refusal before the delete is the archive's, with its fields. `taskIds`
// is the task and every descendant deleted with it. Plugin data goes after the answer.
export type DeleteResult =
  | { ok: true; taskIds: string[]; cleanupFailed?: string[] }
  | Extract<ArchiveResult, { ok: false }>

// The archive options that still mean something when the archive is a step on the way to a delete.
// The worktree always goes.
export type DeleteOpts = Omit<ArchiveOpts, 'deleteWorktree'>

// What a plugin said about a task the owner is about to archive, as the dialog receives it. The node
// mints `id` (`<pluginId>:<checkId>:<concernId>`) and stamps `pluginId`, so a package can neither
// collide with another's checkbox nor draw a row under its name.
export type TaskArchiveConcern = {
  id: string
  pluginId: string
  message: string
  severity: 'warn' | 'danger'
  // At most five, with `detailsMore` counting what did not fit. The host draws "+N more".
  details?: string[]
  detailsMore?: number
  // Present only when the plugin declared a cleanup route to go with it.
  action?: { label: string; checked: boolean }
}

// A read narrowed to the tasks a window draws, such as the rail's rows, names them in `?ids=a,b,c`. A
// hundred UUIDs keep the URL near 4 KB, well inside the Node's header limit.
export const TASK_IDS_PER_READ = 100
export const taskIdsQuery = (ids: readonly string[]): string => `ids=${ids.map(encodeURIComponent).join(',')}`
export const taskIdsQuerySchema = z
  .string()
  .transform((list) => [...new Set(list.split(',').filter(Boolean))])
  .pipe(z.array(z.string().max(200)).min(1).max(TASK_IDS_PER_READ))

// Live worktree status for a task (docs/workspaces-and-tasks.md). `missing` = the task has a
// worktreePath but the directory is gone (removed outside acorn) → needs repair. Computed on the node
// (git status --porcelain + an existence check) and polled by the rail / task footer.
export type TaskStatus = {
  taskId: string
  worktreePath: string | null
  dirty: boolean
  dirtyCount: number
  missing: boolean
  // Where the worktree's HEAD is. Both null when the directory is missing or git could not answer;
  // `branch` alone is null on a detached HEAD. The node compares `head` between polls to emit
  // `head:changed`.
  branch: string | null
  head: string | null
}
