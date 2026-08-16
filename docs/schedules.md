# Schedules

Periodic work owned by the node. One scheduler in the node process, three parties allowed to put work
on it — core, plugins and the user — and a budgeted vocabulary for saying *when*.

The design and the remaining phases are in [`docs/future/cron/`](./future/cron/README.md). This file
describes what is built.

## Why the node, and only the node

A schedule is a promise to run when nobody is looking. Clients close, hide and sleep; the node is the
long-lived process (Electron main's node, or the standalone node) and it is where the mirrors, the
prefs, the plugin routes and the storage already live. So: **one scheduler, node-side; no client ever
owns a timer that fires work.**

Client-side polling — panel refresh, chrome revision — stays what it is: freshness for a person who is
present. The two must not be confused. A panel poll says "I am looking at this"; a schedule says "do
this whether or not anyone is".

The scheduler lives in `packages/node-core/src/server/schedules/`, not in Electron code, so both Node
hosts get the same one by construction. Each composition root
(`apps/node/src/service/runtime.ts`, `apps/node/src/server/standalone.ts`) builds it, provides it as
the `SCHEDULER` capability before the listener binds, starts it after, and stops it in the `schedules`
step of the ordered drain — after the listener, before plugins and SQLite, because a run holds a
database handle.

## The three declarers, one registry

| Owner | Declared how | Key |
| --- | --- | --- |
| **core** | `scheduler.register(...)` in `server/schedules/index.ts` | `core:<id>` |
| **plugin** | not built yet — phase 2 (`future/cron/declarations.md`) | `<pluginId>:<scheduleId>` |
| **user** | `POST /v2/core/schedules`, against a registered target kind | `user:<uuid>` |

Declared schedules are **registry-truth**: the code is the definition, and the database stores only the
owner's overrides and the run state. Disabling a plugin therefore removes its schedules the way it
removes its routes. User schedules are **database-truth**: full rows, parsed tolerantly, unknown kinds
retained inert.

A state row whose declaration is absent is **retained unread**. Disabling a plugin must not delete the
owner's pause or its run history — both are waiting when the plugin returns.

### What is registered today

- `core:audit-prune` — daily at 03:20 node-local. The 90-day audit sweep, which used to be a boot-time
  call in both composition roots and therefore never ran on a node left up for a month.

No plugin schedules and no user target kinds exist yet; those are phases 2 and 3.

## Cadence

A budgeted vocabulary, not a language (`@acorn/protocol/schedules.ts`):

```ts
type Cadence =
  | { every: number }                        // seconds
  | { daily: string }                        // 'HH:MM', node-local
  | { weekly: { day: number; at: string } }  // day 0–6 (Sunday 0), node-local
```

Five-field cron syntax is refused: it is a language to parse, explain and debug, and nothing needs "the
last Friday of the month". Clamps are enforced **on read** — a stored out-of-range value is clamped,
never rejected: `every` ≥ 300s for plugin-declared, ≥ 60s for core and user, ≤ 604 800s (a week).

Node-local time for the calendar forms, because the node is the owner's machine and "03:30" means their
03:30. DST does what local time does and nobody pretends otherwise.

## Policies

- **Jitter.** Interval cadences get ±5% random skew, so every hourly schedule minted at one boot does
  not fire in the same second forever. **Dated cadences are not jittered** — 5% of a day is 72 minutes,
  and `{ daily: '03:30' }` makes a promise about a wall clock that an interval does not.
- **Catch-up, not backfill.** A schedule the node slept through runs **once**, then resumes from now.
  Its run row says `catch-up`. Replaying a week of missed hourly samples would fabricate history the
  node did not witness — worse than the gap, which is honest. No wake signal is wired: a suspended
  timer fires late on resume, which is already the catch-up path.
- **Serialization per schedule.** A schedule whose previous run is still going is never overlapped. The
  loop records a `skipped` run; `run now` is told "already running" rather than silently queued.
- **Global concurrency cap: 4.** The node also serves interactive traffic. Work over the cap stays due
  and is picked up as slots free, in `nextRunAt` order.
- **Timeout per run.** 60s default, 300s ceiling, enforced with an `AbortSignal` handed to the runner.
  A timed-out run records `timeout` and backs off like an error. Nothing here can kill a runner that
  ignores its signal — the slot is released either way, which is the ceiling.
- **Backoff on failure.** `min(cadence × 2ⁿ, 6h)` for n consecutive failures, never sooner than the
  cadence would have fired anyway, reset on success. Visible in settings, because a silent retry loop is
  how rate limits die.
- **A global pause switch** that stops the loop without touching any row — the kill switch for
  "something is wrong and I don't know what yet". Stored under the reserved `'*'` state key.

Runs execute in-process and failures are contained per run: the run row and `lastError` are the blast
radius, never a crashed node.

## Observability

Every run writes a row. `schedule_runs` is a ring of the 20 most recent per schedule, trimmed on write,
so the table is bounded by construction and nothing sweeps it.

## Routes

Behind `requireUser`, and gated with `requireDevice` by mount: a schedule is code the node runs
unattended, so declaring one is node administration and a task-scoped agent must not reach it.

| Route | What |
| --- | --- |
| `GET /v2/core/schedules` | the merged view plus the global pause flag |
| `PATCH /v2/core/schedules` | the global pause switch |
| `POST /v2/core/schedules` | create a user schedule |
| `PATCH /v2/core/schedules/:key` | pause/resume, retune cadence (clamped), rename (user rows only) |
| `DELETE /v2/core/schedules/:key` | user rows only — declared schedules are paused, not deleted |
| `POST /v2/core/schedules/:key/run` | run now (subject to serialization and the cap, not to backoff) |
| `GET /v2/core/schedules/:key/runs` | the ring, newest first |

Creating is the one non-tolerant edge: a create names a target that must resolve **now**, and the risk
tier is read off that target and stamped onto the row. That stamp is the consent record — consent is
taken once, at creation, because 3am cannot answer a confirmation strip.

Plugin frames cannot reach any of these (`client-core/plugins/frames/scopes.ts`): reading the list
enumerates what the machine does unwatched, and creating one is a way to make code run later.

## Settings

Settings → Schedules, per node, sharing the picker with Plugins and Security — a schedule is a promise
one machine makes. One list, owner badge, cadence in words, last run with a status dot, next run, the
run ring behind a disclosure, and the verbs: pause/resume, run now, and delete for user rows. A failed
schedule shows its error inline; a backed-off one says when it will try again. A risky user schedule
carries its tier badge permanently.

There is deliberately no "new schedule" form yet: nothing on this node can run a user-created target,
so a form would be a create button that always fails. It arrives with phase 3.

## Not built yet

Phases 2–4 of `docs/future/cron/`: the plugin manifest descriptor and `ctx.schedules`, the target kinds
(`collection-sample`, `plugin-run`, `node-action`), and the migration of the remaining bespoke timers
(`main/backup.ts`, the agent-usage collector).
