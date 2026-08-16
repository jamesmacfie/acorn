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

**Built.** [`docs/schedules.md`](../../schedules.md) owns the result. What actually shipped, and the
one item this section did not know about:

- **`core:idempotency-sweep`** (daily, 03:05) — *not in the list below, and the real find.*
  `IDEMPOTENCY.cleanupExpired()` was a boot-time call in both composition roots, with a comment
  arguing that "a periodic sweeper would be machinery for a table that holds 24 hours of one owner's
  mutations". That argument was correct when the alternative was a bespoke timer and is spent now —
  it is the audit prune's argument verbatim, and it had the same consequence: a node that runs for
  months reclaims nothing, ever. Both boot calls are deleted.
- **`agents:usage-refresh`** (every 30 minutes, **declared disabled**) — the item below, built as
  described, with one decision the section could not have made. See the note under it.
- **Backup: deferred, deliberately.** Nothing registered. See below.
- **The `setInterval` sweep was re-run and the survivors are exactly the five named below**, plus
  client-side polling, which is not this system. No calendar-shaped work runs off a bespoke timer.

The rest of this section is the analysis it was built from:

- **Backup has no timer to delete.** `main/backup.ts` is route-triggered only (`POST
  /v2/core/backup`); nothing runs it periodically today. Phase 4's backup item is therefore an
  *addition*, not a migration: a `core:backup` schedule (weekly, say, and pausable like everything
  else) that runs the same backup function into a node-owned destination. The open question is the
  destination — the route writes to a caller-chosen path, and a scheduled run has no caller — so
  decide a default (beside the data root) before registering it, or defer the item until someone
  wants unattended backups at all. Do not invent retention for backup archives without being asked.

  **Deferred, and here is the reasoning so it does not have to be redone.** A weekly `core:backup`
  needs a destination, and `suggestBackupPath()` already produces a dated path in the node's HOME —
  so the destination is not the blocker. Retention is. A weekly archive of every database this node
  owns, written forever to a fixed directory, is unbounded disk growth; the only alternatives are
  inventing a retention policy (which this file forbids without being asked) or leaving the owner to
  discover it. Neither is a decision to make on someone's behalf. **The thing to ask before building
  it: how many backups should a node keep?** Everything else is one `scheduler.register` block.
- **The agent-usage collector is the agents plugin's own refresh route**
  (`plugins/agents` § `POST /v2/p/agents/usage/refresh`). The migration is exactly use case 6 and
  is now one phase-2 registration: the plugin declares a schedule (its node half via
  `ctx.schedules.register`, or the manifest key) that hits its own route on its own cadence. No new
  machinery; whoever picks this up should check what currently drives refreshes (a client-side
  trigger keeps working — the schedule just makes the data fresh with no client open).

  **Built, and declared `enabled: false`.** Checking what drives refreshes today answered the
  question this item did not ask. The only thing refreshing the probes is the usage panel being on
  screen (`client/usageStore.ts` polls every five minutes while a consumer is mounted), and the
  snapshot is an **in-process cache** — nothing reads it while no client is open. Refreshing also
  spawns the two provider CLIs. So on by default this would be child processes every half hour,
  forever, on a laptop, warming a value for nobody: strictly more background work than it removed,
  which is the opposite of what phase 4 is for. Off by default it is a visible, pausable, retunable
  row the owner turns on if they want their numbers already fresh when they open the panel — which
  is the entire difference between a schedule and an invisible interval, and the thing the migration
  was actually for. The client's own poll is untouched.
- **The surviving `setInterval`s are not calendar work and stay.** The WS-hub sweep, the tunnel
  sweep, the MCP keepalive, the node broker's timer and the terminal idle watch are housekeeping
  tied to live connections and sessions — their lifetime is the object's, not the clock's, and a
  schedule row for "sweep this map while it exists" would be noise in the settings list. The
  original acceptance test ("`grep setInterval` finds scheduler internals and nothing else") was
  too strong; the honest version: **no *calendar-shaped* work runs off a bespoke timer** — anything
  with a cadence a person might want to see, pause or retune is a row.

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
