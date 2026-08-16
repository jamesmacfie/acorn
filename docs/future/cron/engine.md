# The engine: storage, tick loop, policies, routes

**Built** — [`docs/schedules.md`](../../schedules.md) is the behaviour doc now; this file is kept as the
reasoning behind it, plus the phase-4 migration below, which is not done. Three deviations were taken
during the build and are recorded where they bite: jitter applies to interval cadences only (±5% of a
day would break `{ daily: '03:30' }`); the composition root is `apps/node`'s two roots rather than
`main/bootstrap.ts`, which supervises the node rather than being it; and audit pruning moved onto the
scheduler as part of phase 1 rather than phase 4, because phase 1 needed one real core schedule and that
was the cheapest honest one.

**Phase 1** (`README.md § build order`). One scheduler instance in the node process, owned by the
composition root (`main/bootstrap.ts` registers it, owns its teardown — the boot-order rules in
`docs/architecture-overview.md` apply; signal handlers before the handshake line, as ever). The
standalone node and Electron main's node get the same scheduler by construction, because it lives
in `node-core/server`, not in Electron code.

## Storage

Three Drizzle tables in `node-core/src/server/db/schema.ts`, machine-scoped like every newer
app-state table (the node is single-user; see the schema file's own note):

```ts
// Run state + user overrides for DECLARED schedules (core/plugin), whose definitions live in the
// registry, not here. A state row whose schedule is no longer registered is RETAINED UNREAD —
// the dashboards unknown-ids rule: disabling a plugin must not delete the user's pause or its
// run history, both of which should survive the plugin's return.
export const scheduleState = sqliteTable('schedule_state', {
  key: text('key').primaryKey(),                  // 'core:<id>' | '<pluginId>:<scheduleId>' | 'user:<uuid>'
  enabledOverride: integer('enabled_override'),   // null = declared default; 0/1 = user's word wins
  cadenceOverride: text('cadence_override'),      // JSON cadence, clamped on read, null = declared
  nextRunAt: integer('next_run_at').notNull(),    // epoch ms; the heap is rebuilt from this at boot
  lastRunAt: integer('last_run_at'),
  lastStatus: text('last_status'),                // 'ok' | 'error' | 'timeout' | 'skipped'
  lastError: text('last_error'),                  // one line, human-readable, cleared on ok
  backoffUntil: integer('backoff_until'),
})

// USER-created schedules: full definitions, database-truth. `kind`/`target` parse tolerantly and
// an unknown kind survives inert (renders in settings as "this version cannot run it"), exactly
// like an unknown panel view kind.
export const userSchedules = sqliteTable('user_schedules', {
  id: text('id').primaryKey(),                    // uuid; registry key is `user:<id>`
  name: text('name').notNull(),
  kind: text('kind').notNull(),                   // 'node-action' now; 'agent-run' reserved (targets.md)
  target: text('target').notNull(),               // JSON, kind-shaped
  cadence: text('cadence').notNull(),             // JSON, clamped on read
  risk: text('risk'),                             // ToolRisk, stamped at CREATION from the target's
                                                  // declared tier — the consent record (targets.md)
  createdAt: integer('created_at').notNull(),
})

// Ring of recent runs per schedule, the observability floor. Capped at 20 per key on write
// (delete-oldest), so the table cannot grow unbounded and nobody needs a vacuum job for the
// job-runner's own bookkeeping.
export const scheduleRuns = sqliteTable('schedule_runs', {
  key: text('key').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status').notNull(),               // 'ok' | 'error' | 'timeout' | 'skipped'
  detail: text('detail'),                         // one line; e.g. '14 panels sampled' or the error
}, (t) => [primaryKey({ columns: [t.key, t.startedAt] })])
```

Why state-vs-definition splits by owner: a declared schedule's definition already has a home (the
manifest, the registering module) with a lifecycle the host manages (trust, enable/disable,
uninstall). Copying definitions into rows would mean reconciling two sources of truth on every
boot; storing only state means the plugin's own lifecycle is the schedule's lifecycle for free, and
the retained state row is what makes that lifecycle non-destructive.

## The cadence vocabulary

```ts
type Cadence =
  | { every: number }                          // seconds
  | { daily: string }                          // 'HH:MM', node-local
  | { weekly: { day: number; at: string } }    // day 0–6 (Sunday 0), node-local
```

Clamps, enforced on read (a stored out-of-range value is clamped, never rejected — tolerant-codec
rules): `every` ≥ 300 for plugin-declared, ≥ 60 for core and user, ≤ 604 800 (a week). Node-local
time for the calendar forms because the node is the user's machine and "03:30" means their 03:30;
DST does what local time does and nobody pretends otherwise.

## The loop

A single timer armed for the earliest `nextRunAt` (min-heap over the registry ∪ user rows, rebuilt
at boot from `scheduleState`), re-armed after every run or mutation. Not one timer per schedule —
the heap makes "what fires next" one comparison, and one timer cannot leak.

Policies, each a decision:

- **Jitter.** Every computed `nextRunAt` gets ±5% random skew. Without it, every hourly schedule
  minted at boot fires in the same second forever — thundering herd against the node's own
  concurrency cap and any shared upstream.
- **Catch-up, not backfill.** At boot (and on wake, if the platform surfaces it): any schedule with
  `nextRunAt` in the past runs **once**, then schedules forward from *now* — never one run per
  missed interval (`README.md § refused`). The run's `detail` notes it was a catch-up.
- **Serialization per schedule.** A schedule whose previous run is still going is skipped
  (`status: 'skipped'`, detail says why) and rescheduled; two overlapping runs of the same job is
  how retention jobs corrupt their own tables.
- **Global concurrency cap: 4.** The node also serves interactive traffic; scheduled work queues
  behind the cap in `nextRunAt` order and never starves a person's request.
- **Timeout per run.** Default 60s, declared up to 300s, enforced with an `AbortSignal` handed to
  every runner — the same signal shape collection fetches already take. A timed-out run records
  `'timeout'` and backs off like an error.
- **Backoff on failure.** Next run at `min(cadence × 2ⁿ, 6h)` for n consecutive failures, reset on
  success. Backoff is visible (`backoffUntil` renders in settings as "paused until … after 3
  failures"), because silent retry loops are how rate limits die.
- **A global pause switch** (settings) that stops the loop without touching any row — the kill
  switch for "something is wrong and I don't know what yet".

Runs execute in-process. Failures are contained per run (`try`/`catch` at the loop, never a crashed
node); the run row and `lastError` are the blast radius.

## Core routes (node↔client contract, additive)

Behind the existing `requireUser` gate, house `ApiError`/`respondError` conventions:

- `GET  /v2/core/schedules` → every registry entry ∪ user row, merged with state: key, owner, name,
  kind, cadence (effective + declared), enabled, nextRunAt, lastRunAt, lastStatus, lastError, risk.
- `POST /v2/core/schedules` → create a user schedule (kind, target, cadence, name). Validation is
  the one non-tolerant edge: a *create* names a target that must resolve **now**, and the risk tier
  is read from the target and stamped onto the row here (`targets.md § consent`).
- `PATCH /v2/core/schedules/:key` → pause/resume (`enabledOverride`), retune cadence (clamped),
  rename (user rows only).
- `DELETE /v2/core/schedules/:key` → user rows only. Declared schedules are not deletable — pause
  them; their existence is the plugin's to declare and the trust dialog's to disclose.
- `POST /v2/core/schedules/:key/run` → run now (subject to serialization and the cap; not to
  backoff — a human pressing the button is how you test your way out of a backoff).
- `GET  /v2/core/schedules/:key/runs` → the ring, newest first.

## The settings surface

One list, every schedule, owner badge (`core` / the plugin's brand mark / `user`), name, cadence in
words ("every hour", "daily at 03:30"), last run + status glyph, next run, and the three verbs:
pause/resume, run now, and — user rows — edit/delete. A failed schedule shows `lastError` inline.
Risky user schedules carry their tier badge permanently: the consent taken at creation stays
visible for its whole life. No new UI vocabulary: rows, badges, status dots, armed confirm for
delete — all existing primitives.

## Migration of the invisible intervals (phase 4)

Audit pruning is done (it was phase 1's one core schedule). The rest still stands: the periodic work
already hiding in the codebase moves onto rows and the bespoke timers get **deleted**: backup
(`main/backup.ts`), the agent-usage collection interval. Each becomes a core- or plugin-declared schedule, visible and pausable like
everything else. The acceptance test for this phase is negative: `grep setInterval` over node code
finds scheduler internals and nothing else.

## Done when

- The three tables exist; the loop runs core-registered schedules with jitter, catch-up-once,
  serialization, the cap, timeouts and visible backoff, all unit-tested node-side (the loop takes a
  clock; tests never sleep).
- The routes serve the merged view; pause/retune/run-now/delete behave per owner rules; unknown
  user kinds render inert and survive.
- A state row for an unregistered schedule survives a boot and reattaches when the plugin returns.
- The settings list renders every schedule with working verbs.
- Nothing in any client bundle owns a repeating timer that triggers node work.

## Verify before building

- `main/bootstrap.ts` — the composition root's registration/teardown pattern this joins; the
  standalone node's signal-handler ordering note (`docs/architecture-overview.md`).
- `node-core/src/server/db/schema.ts` + the migration seam (`main/pluginMigrations.ts` /
  `db/cascade.ts`) — table-adding conventions.
- `server/routeRegistry.ts` + an existing core route (prefs) — route registration, `requireUser`,
  `ApiError` shapes.
- `server/background.ts` — the fire-and-forget tracker; scheduled runs should reuse or extend its
  settle-in-tests pattern rather than inventing a second one.
- Whether the platform exposes a wake/resume signal worth wiring for catch-up, or whether boot +
  a long-overdue check on each tick suffices.
- Existing intervals to migrate in phase 4: `main/backup.ts`, audit pruning (`server/audit.ts`),
  the agent-usage collector — confirm each still exists and how it is currently triggered.
