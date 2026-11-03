// Archives that keep running after their request has been answered
// (docs/workspaces-and-tasks/background-archive.md). A project's teardown script can run for
// minutes, longer than any client waits on one request.
//
// Process-local, like the archive gate (../worktrees/archiveGate.ts). A restart drops every record, and
// a client that asks afterwards reads `none`.
import type { ArchiveResult, ArchiveRun } from '@acorn/protocol/task.ts'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('archive')

// Long enough for every client waiting on the archive to read its outcome.
const KEEP_FINISHED_MS = 10 * 60_000

type Run = { done: Promise<unknown>; result?: ArchiveResult; finishedAt?: number }
const runs = new Map<string, Run>()

function prune(): void {
  const cutoff = Date.now() - KEEP_FINISHED_MS
  for (const [taskId, run] of runs) if (run.finishedAt !== undefined && run.finishedAt < cutoff) runs.delete(taskId)
}

/** Starts archiving the task, unless an archive started here for it is still running, which then
 *  answers for both. */
export function startArchiveRun(taskId: string, archive: () => Promise<ArchiveResult>): void {
  prune()
  const current = runs.get(taskId)
  if (current && !current.result) return
  const run: Run = { done: Promise.resolve() }
  run.done = archive()
    .catch((error: unknown): ArchiveResult => {
      const { message } = describeError(error)
      log.warn(`archive of ${taskId} failed: ${message}`)
      return { ok: false, reason: message }
    })
    .then((result) => {
      run.result = result
      run.finishedAt = Date.now()
    })
  runs.set(taskId, run)
}

/** The archive's state, after waiting up to `waitMs` for a running one to finish. */
export async function archiveRunState(taskId: string, waitMs: number): Promise<ArchiveRun> {
  prune()
  const run = runs.get(taskId)
  if (!run) return { state: 'none' }
  if (!run.result && waitMs > 0) {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([run.done, new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))])
    clearTimeout(timer)
  }
  return run.result ? { state: 'finished', result: run.result } : { state: 'running' }
}
