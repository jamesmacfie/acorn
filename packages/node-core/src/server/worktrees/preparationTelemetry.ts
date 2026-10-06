import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import { runWithTelemetry, startSpan } from '../telemetry/collector'
import { currentTelemetryContext } from '../telemetry/context'

type WorktreePhase = 'git.fetch' | 'git.worktree.add' | 'worktree.validate' | 'files.copy' | 'setup.admit'

/** Enter each preparation span so Git, hooks, and failures keep the caller's trace and owner.
 *  See docs/telemetry/runtimes.md § Node seams. */
async function preparation<T>(name: string, attrs: TelemetryAttrs, run: () => Promise<T>): Promise<T> {
  const span = startSpan('core', { name, attrs: { ...attrs, seam: name } })
  if (!span.traceId) return run()
  try {
    const result = await runWithTelemetry({
      traceId: span.traceId, spanId: span.spanId, owner: currentTelemetryContext()?.owner ?? 'core',
    }, run)
    span.end('ok')
    return result
  } catch (error) {
    span.end('error')
    throw error
  }
}

export const prepareTask = <T>(taskId: string, shared: boolean, run: () => Promise<T>): Promise<T> =>
  preparation(shared ? 'task.prepare.wait' : 'task.prepare', { 'task.id': taskId, shared }, run)

export const prepareWorktreePhase = <T>(phase: WorktreePhase, run: () => Promise<T>): Promise<T> =>
  preparation('task.prepare.phase', { phase }, run)
