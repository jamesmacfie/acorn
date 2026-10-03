import type { PrefService } from '@acorn/plugin-api/node'
import { AGENT_ARCHIVED_HISTORY_CHOICES } from '../../shared/sessionDefaults'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'
import type { ManagedAgentRuntime } from './runtime'

// The `agents:archived-history-prune` schedule (docs/data-layer/backup-and-retention.md § Retention). It reads the owner's
// "Keep agent history for archived tasks" and asks the runtime to remove the history of every session
// whose task has been archived longer than that (runtime.ts § removeArchivedHistory).

const DAY_MS = 86_400_000

// The engine's ceiling is 300s, and a run that reaches it is recorded as a timeout and backs off like
// a failure. A large first pass is not a failure, so the run stops itself before then and the next day's
// run carries on.
const RUN_BUDGET_MS = 240_000

export async function removeExpiredHistory(options: {
  runtime: Pick<ManagedAgentRuntime, 'removeArchivedHistory'>
  prefs: PrefService
  userId: string | null
  archivedBefore: (before: number) => Promise<string[]>
  signal: AbortSignal
  now?: () => number
  batch?: number
}): Promise<string> {
  const now = options.now ?? Date.now
  // The limit is in the owner's preferences, and a node nobody is bound to has none to read.
  if (!options.userId) return 'no owner is bound to this node yet'
  const { keepArchivedHistoryDays: days } = await readAgentSessionDefaults(options.prefs, options.userId)
  if (!days) return 'agent history is kept forever'
  const label = AGENT_ARCHIVED_HISTORY_CHOICES.find((choice) => choice.days === days)?.label ?? `${days} days`
  const result = await options.runtime.removeArchivedHistory({
    // Asked before every step, so a task restored during the run is left alone from then on.
    taskIds: () => options.archivedBefore(now() - days * DAY_MS),
    note: `Acorn removed this session's history because its task had been archived for more than ${label}.`,
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(RUN_BUDGET_MS)]),
    ...(options.batch ? { batch: options.batch } : {}),
  })
  const removed = `removed the history of ${result.sessions} sessions (${result.events} events)`
  return result.complete ? removed : `${removed}; stopped early, and the next run carries on`
}
