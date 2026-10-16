import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import { runInSpan } from '../telemetry/collector'

type WorktreePhase = 'git.fetch' | 'git.worktree.add' | 'worktree.validate' | 'files.copy' | 'setup.admit'

/** Enter each preparation span so Git, hooks, and failures keep the caller's trace and owner.
 *  See docs/telemetry/runtimes.md § Node seams. */
const preparation = <T>(name: string, attrs: TelemetryAttrs, run: () => Promise<T>): Promise<T> =>
  runInSpan('core', { name, attrs: { ...attrs, seam: name } }, run)

export const prepareTask = <T>(taskId: string, shared: boolean, run: () => Promise<T>): Promise<T> =>
  preparation(shared ? 'task.prepare.wait' : 'task.prepare', { 'task.id': taskId, shared }, run)

export const prepareWorktreePhase = <T>(phase: WorktreePhase, run: () => Promise<T>): Promise<T> =>
  preparation('task.prepare.phase', { phase }, run)
