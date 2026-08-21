import type { Env } from '../../main/bindings'
import { pruneAudit } from '../audit'
import { routeCapability } from '../bridge'
import { compactHistory } from '../dashboards/history'
import { definedPanelIds, describeSamplePass, readDashboardPrefs, runSamplePass } from '../dashboards/sampler'
import type { AppDatabase } from '../db'
import { registerNodeActionTarget } from './nodeAction'
import { type Clock, Scheduler } from './scheduler'

export { keyOwner, Scheduler } from './scheduler'
export type { Clock, CreateScheduleInput, DeclaredSchedule, PatchScheduleInput, ScheduleRunner, ScheduleTarget } from './scheduler'

/** The handle on the one scheduler this process owns. A capability rather than a binding on c.env for
 *  the same reason PLUGIN_STATE is one: the scheduler only exists once the composition root has built
 *  it, and its lifetime (start, drain, stop) belongs to whoever owns teardown, which makeBindings,
 *  having no stop(), does not.
 *
 *  `register` is here for the plugin context, not for a route. `ctx.schedules.register` resolves the
 *  scheduler through this capability at call time rather than being threaded through initPlugins, the
 *  same late binding every other cross-plugin need uses (server/plugin/host.ts). Not `start`, `stop`
 *  or the constructor: the composition root owns the lifetime and nothing else may. */
export type SchedulerBridge = Pick<Scheduler, 'list' | 'runs' | 'create' | 'confirm' | 'patch' | 'remove' | 'runNow' | 'paused' | 'setPaused' | 'register'>
export const SCHEDULER = routeCapability<SchedulerBridge>('core.scheduler')

/** Builds the node's scheduler and declares core's own periodic work on it (docs/schedules.md
 *  § Why the node, and only the node). */
export type CreateSchedulerOptions = {
  clock?: Clock
  // The node's bindings. Optional because a test that only exercises the engine needs none, and
  // because the two schedules and the one target below are exactly the work that reaches out of the
  // scheduler, into plugin routes and the identity store. A scheduler built without env simply
  // declares the audit prune, which is the only core job that is pure database work.
  env?: Env
}

export function createScheduler(db: AppDatabase, options: CreateSchedulerOptions = {}): Scheduler {
  const scheduler = new Scheduler(db, options)

  // core:audit-prune (docs/schedules.md § What is registered today).
  scheduler.register({
    key: 'core:audit-prune',
    name: 'Prune the audit log',
    cadence: { daily: '03:20' },
    run: async () => `${await pruneAudit(db)} entries older than 90 days removed`,
  })

  if (options.env) {
    const env = options.env

    scheduler.register({
      key: 'core:idempotency-sweep',
      name: 'Reclaim expired replay rows',
      cadence: { daily: '03:05' },
      run: async () => {
        await env.IDEMPOTENCY.cleanupExpired()
      },
    })

    // core:sample-measures (docs/schedules.md § What is registered today; § Policies for jitter and
    // timeout). The timeout is generous because a pass dispatches one in-process read per source per
    // panel; a pass that runs out of time simply records fewer panels and says so, the same shape as
    // a skip.
    scheduler.register({
      key: 'core:sample-measures',
      name: 'Record dashboard measures',
      cadence: { every: 60 * 60 },
      timeoutMs: 120_000,
      run: async (signal) => describeSamplePass(await runSamplePass(db, env, signal)),
    })

    // core:compact-history (docs/schedules.md § What is registered today).
    scheduler.register({
      key: 'core:compact-history',
      name: 'Compact dashboard history',
      cadence: { daily: '03:40' },
      run: async () => {
        // `null` when the blob could not be read, which skips the orphan sweep. Deleting every series
        // because a preference read failed would be the worst available response to a transient error.
        const prefs = await readDashboardPrefs(db, env)
        const live = prefs === null ? null : definedPanelIds(prefs)
        const { collapsed, dropped, orphaned } = await compactHistory(db, Date.now(), live)
        return `${collapsed} collapsed to daily, ${dropped} dropped, ${orphaned} removed with their panel`
      },
    })

    // The one user-schedule target this build can run (docs/schedules.md § `node-action`). Registered
    // here rather than through the bridge because the target is core's: it dispatches a plugin's own
    // route the same way a click does, and owning that dispatch is not something a plugin should be
    // able to register on its own behalf.
    registerNodeActionTarget(scheduler, env)
  }

  return scheduler
}
