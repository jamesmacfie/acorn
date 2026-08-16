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
| **plugin** | `schedules` in its manifest, or `ctx.schedules.register(...)` node-side | `<pluginId>:<scheduleId>` |
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
- `core:idempotency-sweep` — daily at 03:05. Reclaims expired replay rows, which was also a boot-time
  call in both roots and had the same problem: expired rows already *read* as absent, so a node running
  for months quietly accumulated every mutation it had ever replayed.
- `core:sample-measures` — hourly, jittered. One pass over every dashboard panel that asked for a
  history trend, recording one number apiece (§ Targets, and `docs/future/dashboards/measure-history.md`).
- `core:compact-history` — daily at 03:40. Measure history's own retention.

All but the audit prune are declared only when the composition root passes `env` to `createScheduler`,
which both Node hosts do; a scheduler built without one (a test) declares just the prune, because the
other three reach out of the process.

One plugin declares a schedule:

- `agents:usage-refresh` — every 30 minutes, and **off unless you turn it on**. It re-probes the agent
  CLIs for plan usage so the numbers are already fresh when you open the panel. Off by default because
  refreshing spawns those CLIs and the snapshot is an in-process cache nothing reads while no client is
  open — unattended freshness here is a real cost for a value only a person present benefits from, so
  it is the owner's call. Turning it on is the enable toggle on its row, and that survives restarts.

### How a plugin declares one

Two feeders, one registry, indistinguishable downstream — the collections pattern applied to schedules.

A **loaded** plugin declares it in its manifest, because a manifest is also what the owner is shown at
install (`docs/plugins.md § Descriptors`): an id, a name, a `run` route confined to the plugin's own
`/v2/p/<id>/` namespace, a cadence and an optional timeout in seconds. The node POSTs `{ scheduleId }`
to that route on the cadence, in process, as its own `'service'` principal — the same request context an
HTTP-served route gets, built from the same function — and ignores the answer beyond ok/error. A non-2xx
is a failed run, which means backoff and a visible error, not a crashed node. Confinement is checked at
manifest parse *and* again on every fire.

A **compiled** plugin has no manifest, so it registers in `init`:

```ts
ctx.schedules.register({
  scheduleId: 'refresh-pull-mirror',
  name: 'Refresh pull request mirror',
  cadence: { every: 3600 },
  timeout: 120,                       // seconds here; the engine's DeclaredSchedule is milliseconds
  run: async (signal: AbortSignal) => { await refreshPullMirror(signal) },
})
```

The host binds `pluginId` from the registering plugin in both cases — a schedule cannot be filed under a
stranger's name — mints the `<pluginId>:<scheduleId>` key, and ties removal to the plugin's teardown.
Declaring the schedule **is** the lifecycle; a `setInterval` in plugin node code is a review flag.

At most four per plugin. The 300s interval floor comes from the key prefix, on read, like every other
clamp.

#### The override model

The registry — manifest or code — is the **definition**; `scheduleState` holds the owner's overrides
plus the run state. A pause beats the declared default, and a cadence retune beats the declared cadence
(clamped again on read); a plugin cannot un-pause itself by re-declaring. Everything else — name, route
or handler, timeout — is definition-owned. Someone who wants a schedule to *do something else* wants a
schedule of their own, not an edited plugin one.

#### Lifecycle

| Event | Effect |
| --- | --- |
| Plugin disabled / uninstalled | Its schedules leave the registry and stop firing. Their `scheduleState` rows — pause, backoff, history — are **retained unread**. |
| Plugin returns | Definitions re-register; retained state reattaches by key. A pause survives the round trip. |
| Manifest drops a schedule id | Same as disabled, for that id: state retained, nothing fires. |
| Manifest changes cadence | The new declared cadence applies unless a retune exists — the owner's word keeps winning. |
| Plugin reloaded (dev loop) | The candidate's schedules are buffered like every other registration and swapped in only on commit; a failed reload leaves the previous instance's firing. |

None of that is schedule-specific policy. It is the engine's retain-the-state-row rule and the host's
registration lifecycle, restated for this kind.

#### Trust

A schedule joins the **Declared** group of the trust dialog and of the agent-install review screen, and
is recorded with the decision so an update that changes a cadence reads as newly requested. It is
disclosure, not new capability: the run route is one the plugin already owns and could already reach
from any of its surfaces. What changes is that it runs with **no client open**, which is worth a line of
ink at trust time.

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

## Targets: what a user schedule may do

A user row names a **kind** and a kind-shaped **target**. The vocabulary is closed and unknown kinds
survive inert — a row created by a newer build lists, never runs, and says so.

| Kind | What runs |
| --- | --- |
| `node-action` | a plugin action the owner scheduled, dispatched as a POST to that plugin's own route |
| `agent-run` | **reserved, unbuilt** — gated on a headless agent runtime existing at all |

`collection-sample` is deliberately **not** a user kind. Measure sampling is one core schedule over
every history-trend panel, not a row per panel, so turning a trend on in the panel editor never conjures
a hidden schedule — the next `core:sample-measures` pass simply picks the panel up.

### `node-action`

The target is `{ pluginId, actionId, params }`. What runs is the same `runNodeAction` path a click
takes — the plugin's own confined route, POSTed in process with the params as the body — so a scheduled
fire and a clicked one are indistinguishable to the handler. The schedule owns only *when*.

What can be scheduled comes from a node-side registry with two feeders, the same shape schedules and
collections have:

- **compiled**: `ctx.nodeActions.register({ actionId, name, path, risk })` in the plugin's node init.
- **loaded**: synthesised from manifest **commands** whose verb is `runNodeAction`. No new descriptor
  kind — the plugin wire contract did not grow.

An action that declares no tier is treated as `execute`, the strongest. That is a deliberate repair
rather than a default: a chrome action descriptor has no `risk` field today, and "nobody has said what
this does" is not an argument for arming the weakest confirmation.

### Consent, and the two ways it fails closed

Consent is taken **at creation, whole**. The creation flow reads the target's declared tier, draws the
confirmation that tier would get on a click — host-drawn, naming the plugin, impossible to skip — and
the accepted tier is **stamped onto the row** (`user_schedules.risk`). Runs never prompt after that: an
unattended prompt is either ignored (the schedule silently does nothing) or auto-accepted (a lie about
consent). The stamp renders on the settings row for the schedule's whole life.

- **The tier rises.** A plugin update declaring `execute` where it said `write` invalidates the stamp.
  The run is `skipped` with "risk changed — re-confirm to resume", and the settings row offers the
  re-arm. Stamped consent covers the tier it stamped, nothing higher.
- **The target stops resolving.** Plugin gone, disabled, action renamed: `skipped` with the reason. The
  row survives inert and reattaches by itself if the action returns.

Both are recorded as `skipped`, not as errors — no backoff, no red row. A schedule failing closed is
behaving correctly, and backing it off exponentially would punish the owner for someone else's edit.
A target says so by throwing `ScheduleSkipped`.

## Reading a collection from the node

The measure sampler needs to read a collection with no client attached, which needed a registry the
node did not have: `(pluginId, collectionId)` → the route that answers
(`server/collections/registry.ts`). Every collection was always ultimately a node route — a loaded
plugin's `items` is one, and a compiled plugin's client-side `fetch` is a thin wrapper over one — so
this is the missing map and nothing more. Two feeders again: manifest `collections` descriptors for the
loaded tier, `ctx.collections.register({ collectionId, items })` for the compiled one.

Answers take the same parse the client path takes (`pluginCollectionResponseSchema`) and are dropped
whole on failure; provenance is host-stamped; caps hold. **A sampling read never forces revalidation** —
it serves whatever the plugin's route serves, at its mirror's age. A plugin that wants fresher
unattended data declares its own refresh schedule and pays for it from its own rate budget.

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
| `GET /v2/core/schedules/targets` | what this node can run, for the creation picker |
| `POST /v2/core/schedules` | create a user schedule |
| `POST /v2/core/schedules/:key/confirm` | re-take consent after a target's tier rose |
| `PATCH /v2/core/schedules/:key` | pause/resume, retune cadence (clamped), rename (user rows only) |
| `DELETE /v2/core/schedules/:key` | user rows only — declared schedules are paused, not deleted |
| `POST /v2/core/schedules/:key/run` | run now (subject to serialization and the cap, not to backoff) |
| `GET /v2/core/schedules/:key/runs` | the ring, newest first |

Creating is the one non-tolerant edge: a create names a target that must resolve **now**, and the risk
tier is read off that target and stamped onto the row. That stamp is the consent record — consent is
taken once, at creation, because 3am cannot answer a confirmation strip.

`confirm` takes **no body**. The node re-stamps from its own registry, so a client can only ever accept
the tier the host just showed; letting it post a tier would make the confirmation something a client
could quietly widen, which is the one property the arming rule exists to prevent.

Plugin frames cannot reach any of these (`client-core/plugins/frames/scopes.ts`): reading the list
enumerates what the machine does unwatched, and creating one is a way to make code run later.

## Settings

Settings → Schedules, per node, sharing the picker with Plugins and Security — a schedule is a promise
one machine makes. One list, owner badge, cadence in words, last run with a status dot, next run, the
run ring behind a disclosure, and the verbs: pause/resume, run now, and delete for user rows. A failed
schedule shows its error inline; a backed-off one says when it will try again. A risky user schedule
carries its tier badge permanently.

The creation form is four fields and no wizard: pick an action, see its tier and accept it, name it, say
when. The picker offers only what resolves on that node right now, so there is no invalid choice to
validate after the fact — and when nothing offers a schedulable action the form is replaced by a
sentence saying so rather than a create button that always fails. A row whose tier has risen shows the
re-arm inline.

## What deliberately is not a schedule

The sweep was re-run across the tree and these stay on their own timers, because their lifetime is an
object's rather than the clock's: the WS-hub sweep, the tunnel sweep, the MCP keepalive and the terminal
idle watch. A settings row for "sweep this map while it exists" would be noise. The honest rule is not
"no `setInterval` outside the scheduler" but **no *calendar-shaped* work runs off a bespoke timer** —
anything with a cadence a person might want to see, pause or retune is a row.

Client-side polling is also not this system and never becomes one. A panel refresh or the usage store's
five-minute poll is freshness for a person who is present; a schedule is work that happens whether or
not anyone is.

`pruneOrphanedGithubMirror` stays a boot-time call for the same reason: it repairs installations
affected by a historic eviction bug and converges to zero, so it is startup reconciliation, not
retention.

## Not built yet

- **Unattended backup.** `main/backup.ts` is route-triggered only, and a `core:backup` schedule is one
  registration away — but it needs a retention policy nobody has asked for yet, and a weekly archive of
  every database written forever to one directory is unbounded disk growth. The open question is *how
  many backups should a node keep*; `docs/future/cron/engine.md § migration` has the reasoning.
- **`agent-run`**, named in the vocabulary and gated on a headless agent runtime.
- **The display half of measure history** — sparkline and delta
  (`docs/future/dashboards/measure-history.md § Display`). The store accrues samples today; nothing
  draws them yet.
