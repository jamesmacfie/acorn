// Core task, worktree and archive wire contracts.
export type WorktreeResult = { ok: true; path: string } | { ok: false; reason: string }

// Result of archiving a task (docs/workspaces-and-tasks.md). `reason` carries the guard refusal
// (running sessions / dirty worktree) for the UI to surface. A failed teardown script
// (docs/terminal-and-agents.md) sets teardownFailed so the UI can offer continue (re-archive with
// skipTeardown) or abort; `output` is the script's tail for display.
// `cleanupFailed` names the plugins whose opted-in cleanup threw. `reviewCaptureFailed` says the
// pre-teardown handoff to the review provider failed. `ok` is still true: the task is archived, and
// reporting a failure would have the caller offering to retry something already done.
export type ArchiveResult =
  | { ok: true; cleanupFailed?: string[]; reviewCaptureFailed?: boolean }
  | { ok: false; reason: string; teardownFailed?: boolean; output?: string }

export type ArchiveOpts = {
  deleteWorktree?: boolean
  force?: boolean
  skipTeardown?: boolean
  // Qualified concern ids whose checkbox the owner left ticked in the archive dialog. Matched against
  // the node's own task-check registry before anything runs, never treated as a route
  // (node-core/server/pluginHost/taskChecks.ts).
  applyChecks?: string[]
}

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

// Live worktree status for a task (docs/workspaces-and-tasks.md). `missing` = the task has a
// worktreePath but the directory is gone (removed outside acorn) → needs repair. Computed in main
// (git status --porcelain + an existence check) and polled by the rail / task footer.
export type TaskStatus = {
  taskId: string
  worktreePath: string | null
  dirty: boolean
  dirtyCount: number
  missing: boolean
  // Where the worktree's HEAD is. Both null when the directory is missing or git could not answer;
  // `branch` alone is null on a detached HEAD. The node compares `head` between polls to emit
  // `head:changed` (@acorn/protocol/nodeEvents.ts).
  branch: string | null
  head: string | null
}
