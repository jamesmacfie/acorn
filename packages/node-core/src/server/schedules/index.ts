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
 *  it, and its lifetime (start, drain, stop) belongs to whoever owns teardown — which makeBindings,
 *  having no stop(), is not.
 *
 *  `register` is here for the plugin context, not for a route: `ctx.schedules.register` resolves the
 *  scheduler through this capability at CALL time rather than being threaded through initPlugins, which
 *  is the same late binding every other cross-plugin need uses (server/plugin/host.ts). Not `start`,
 *  `stop` or the constructor — the composition root owns the lifetime and nothing else may. */
export type SchedulerBridge = Pick<Scheduler, 'list' | 'runs' | 'create' | 'confirm' | 'patch' | 'remove' | 'runNow' | 'paused' | 'setPaused' | 'register'>
export const SCHEDULER = routeCapability<SchedulerBridge>('core.scheduler')

/** Build the node's scheduler and declare core's own periodic work on it. Both Node hosts call this —
 *  the standalone node and Electron main's node get the same scheduler by construction, because it
 *  lives here and not in Electron code. */
export type CreateSchedulerOptions = {
  clock?: Clock
  // The node's bindings. Optional because a test that only exercises the engine needs none — and
  // because the two schedules and the one target below are exactly the work that reaches OUT of the
  // scheduler, into plugin routes and the identity store. A scheduler built without env simply
  // declares the audit prune, which is the only core job that is pure database work.
  env?: Env
}

export function createScheduler(db: AppDatabase, options: CreateSchedulerOptions = {}): Scheduler {
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

  // Idempotency replay rows (docs/api-reference.md § HTTP conventions), which used to be reclaimed by a
  // boot-time call in both composition roots. That call carried an argument in its comment — "a periodic
  // sweeper would be machinery for a table that holds 24 hours of one owner's mutations" — and the
  // argument was right when the only alternative was a bespoke timer. It is spent now, for the same
  // reason the audit prune's was: the machinery exists, and a boot-only sweep is exactly nothing on a
  // node that runs for months, which is the node this project ships. Expired rows already READ as
  // absent, so this is space, not correctness.

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

    // The driver (docs/future/dashboards/measure-history.md). ONE schedule for every panel that asked
    // for a history trend, not a row per panel: panel churn must never create or delete schedule rows,
    // and turning a trend on in the editor is a checkbox, not a hidden registration.
    //
    // Hourly, and jittered by the engine like everything else — a fleet of nodes all sampling on the
    // stroke of the hour would be a self-inflicted thundering herd against the same provider APIs.
    // The timeout is generous because a pass dispatches one in-process read per source per panel; a
    // pass that runs out of time simply records fewer panels and says so, which is the same shape as
    // a skip.
    scheduler.register({
      key: 'core:sample-measures',
      name: 'Record dashboard measures',
      cadence: { every: 60 * 60 },
      timeoutMs: 120_000,
      run: async (signal) => describeSamplePass(await runSamplePass(db, env, signal)),
    })

    // Measure history's own maintenance, and the sibling that makes the store's caps true rather than
    // aspirational (…/measure-history.md § Caps and retention).
    scheduler.register({
      key: 'core:compact-history',
      name: 'Compact dashboard history',
      cadence: { daily: '03:40' },
      run: async () => {
        // `null` when the blob could not be read, which SKIPS the orphan sweep. Deleting every series
        // because a preference read failed would be the worst available response to a transient error.
        const prefs = await readDashboardPrefs(db, env)
        const live = prefs === null ? null : definedPanelIds(prefs)
        const { collapsed, dropped, orphaned } = await compactHistory(db, Date.now(), live)
        return `${collapsed} collapsed to daily, ${dropped} dropped, ${orphaned} removed with their panel`
      },
    })

    // The one user-schedule target this build can run (docs/future/cron/targets.md § node-action).
    // Registered here rather than through the bridge because the target is CORE's: it dispatches a
    // plugin's own route the same way a click does, and owning that dispatch is not something a
    // plugin should be able to register on its own behalf.
    registerNodeActionTarget(scheduler, env)
  }

  return scheduler
}
