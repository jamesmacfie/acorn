import { pruneAudit } from '../audit'
import { routeCapability } from '../bridge'
import type { AppDatabase } from '../db'
import { type Clock, Scheduler } from './scheduler'

export { keyOwner, Scheduler } from './scheduler'
export type { Clock, CreateScheduleInput, DeclaredSchedule, PatchScheduleInput, ScheduleRunner, ScheduleTarget } from './scheduler'

/** The routes' handle on the one scheduler this process owns. A capability rather than a binding on
 *  c.env for the same reason PLUGIN_STATE is one: the scheduler only exists once the composition root
 *  has built it, and its lifetime (start, drain, stop) belongs to whoever owns teardown — which
 *  makeBindings, having no stop(), is not. */
export type SchedulerBridge = Pick<Scheduler, 'list' | 'runs' | 'create' | 'patch' | 'remove' | 'runNow' | 'paused' | 'setPaused'>
export const SCHEDULER = routeCapability<SchedulerBridge>('core.scheduler')

/** Build the node's scheduler and declare core's own periodic work on it. Both Node hosts call this —
 *  the standalone node and Electron main's node get the same scheduler by construction, because it
 *  lives here and not in Electron code. */
export function createScheduler(db: AppDatabase, options: { clock?: Clock } = {}): Scheduler {
  const scheduler = new Scheduler(db, options)

  // Audit retention (docs/data-layer.md § Retention defaults: 90 days). This used to be a boot-time
  // call in both composition roots, with a comment arguing that a scheduler for one range-delete a day
  // would be machinery this does not need. The machinery now exists for other reasons, so the argument
  // is spent — and a node left running for a month used to prune nothing at all, which was the real
  // cost of tying retention to restarts.
  scheduler.register({
    key: 'core:audit-prune',
    name: 'Prune the audit log',
    cadence: { daily: '03:20' },
    run: async () => `${await pruneAudit(db)} entries older than 90 days removed`,
  })

  return scheduler
}
