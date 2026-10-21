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
