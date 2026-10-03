# Schedules

This page covers periodic work owned by the Node: one scheduler in the Node process, three parties
that may put work on it (core, plugins, and the user), and a budgeted vocabulary for saying when. Read
it before you add anything that runs on a clock.

## Pages

<a id="how-a-plugin-declares-one"></a>
<a id="the-override-model"></a>
<a id="lifecycle"></a>
<a id="trust"></a>

[Plugin schedules](./schedules/plugin-schedules.md) covers how a loaded or compiled plugin declares a
schedule, the owner's overrides, the lifecycle, and the trust disclosure.

<a id="targets-what-a-user-schedule-may-do"></a>
<a id="node-action"></a>
<a id="consent-and-the-two-ways-it-fails-closed"></a>
<a id="workflow"></a>
<a id="routes"></a>
<a id="settings"></a>

[User schedules](./schedules/user-schedules.md) covers target kinds, `node-action`, consent and how it
fails closed, workflow schedules, the routes, and Settings → Schedules.

## Why the node, and only the node

A schedule is a promise to run when nobody is looking. Clients close, hide, and sleep. The Node is the
long-lived process, and it's where the mirrors, the preferences, the plugin routes, and the storage
live. So there's one scheduler, on the Node, and no client owns a timer that fires work.

Client polling, such as a panel refresh, is freshness for a person who's present. A panel poll says
"I'm looking at this". A schedule says "do this whether or not anyone is".

The scheduler lives in `packages/node-core/src/server/schedules/`, so both Node hosts get the same one.
Each composition root (`apps/node/src/composition/runtime.ts`, `apps/node/src/entries/standalone.ts`)
builds it, provides it as the `SCHEDULER` capability before the listener binds, starts it after, and
stops it in the `schedules` step of the ordered drain. That step sits after the listener and before
plugins and SQLite, because a run holds a database handle.

## The three declarers, one registry

| Owner | Declared how | Key |
| --- | --- | --- |
| Core | `scheduler.register(…)` in `server/schedules/index.ts` | `core:<id>` |
| A plugin | `schedules` in its manifest, or `ctx.schedules.register(…)` in a compiled plugin | `<pluginId>:<scheduleId>` |
| The user | `POST /v1/core/schedules`, against a registered target kind | `user:<uuid>` |

A declared schedule is registry-truth: the code is the definition, and the database stores only the
owner's overrides and the run state in `schedule_state`. Disabling a plugin removes its schedules the
way it removes its routes. A user schedule is database-truth: a full row in `user_schedules`, parsed
tolerantly, with unknown kinds kept inert. A state row whose declaration is absent is kept unread, so
disabling a plugin doesn't delete the owner's pause or run history.

### What is registered

- `core:audit-prune`, daily at 03:20 Node-local: the 90-day audit sweep.
- `core:idempotency-sweep`, daily at 03:05: reclaims expired replay rows.
- `core:sample-measures`, hourly with jitter: one pass over every dashboard panel that asked for a
  history trend, recording one number each ([sampling a published dashboard](#sampling-a-published-dashboard)).
- `core:compact-history`, daily at 03:40: measure history's own retention.
- `agents:usage-refresh`, every 30 minutes, off by default. It probes the agent CLIs for plan usage so
  the numbers are fresh when you open the panel. It spawns those CLIs to fill a cache nothing reads
  while no client is open, so turning it on is the owner's call, with the toggle on its row.
- `agents:archived-history-prune`, daily at 03:50. It removes the agent history of tasks archived longer
  than the owner keeps it ([retention](./data-layer/backup-and-retention.md#retention)). It does nothing
  until the owner changes **Keep agent history for archived tasks** from Forever, and that setting is
  the switch. It stops itself after four minutes, under the 300-second ceiling, and the next run carries
  on.

Core declares all but the audit prune only when the composition root passes `env` to
`createScheduler`, which both Node hosts do. A scheduler built without it, as in a test, declares only
the prune.

## Cadence

A budgeted vocabulary, not a language (`@acorn/protocol/schedules.ts`):

```ts
type Cadence =
  | { every: number }                        // seconds
  | { daily: string }                        // 'HH:MM', Node-local
  | { weekly: { day: number; at: string } }  // day 0–6 (Sunday 0), Node-local
```

Five-field cron syntax is refused. It's a language to parse, explain, and debug, and nothing needs "the
last Friday of the month". Clamps apply on read, so a stored out-of-range value is clamped, never
rejected. `every` is at least 300 seconds for a plugin, at least 60 seconds for core and the user, and
at most 604,800 seconds, a week. Calendar forms use Node-local time, because the Node is the owner's
machine. A target may bind an IANA timezone when the work must keep a portable wall clock, as the
workflow target does.

The renderer has its own `ctx.schedules`, and it isn't this one. A client schedule takes a raw
`intervalMs` with no floor (`packages/client-core/src/host/registries/shell/schedules.ts`), because
below the 300-second floor a schedule is a poll, and polling is the client's job. It starts when its
plugin becomes available, stops when the plugin goes, admits no reads in a hidden window, and coalesces
timer, event, and visibility edges into one refresh and one follow-up.

## Policies

- **Jitter.** Interval cadences get ±5% random skew, so hourly schedules minted at one boot don't fire
  in the same second forever. Dated cadences aren't jittered, because `{ daily: '03:30' }` promises a
  wall clock.
- **Catch-up, not backfill.** A schedule the Node slept through runs once, records `catch-up`, and
  resumes. Replaying a week of missed hourly samples would fabricate history the Node didn't witness.
  A suspended timer fires late on resume, which is the catch-up path.
- **One run at a time per schedule.** A schedule whose previous run is still going records a `skipped`
  run, and **Run now** answers "already running" rather than queueing.
- **A global cap of four.** The Node also serves interactive traffic. Work over the cap stays due and
  runs as slots free, in `nextRunAt` order.
- **A timeout per run.** 60 seconds by default and 300 at most, enforced with an `AbortSignal`. A
  timed-out run records `timeout` and backs off like an error. Nothing can kill a runner that ignores
  its signal, but its slot is released either way.
- **Backoff on failure.** `min(cadence × 2ⁿ, 6h)` for n consecutive failures, never sooner than the
  cadence, reset on success. Settings shows it, because a silent retry loop is how rate limits die.
- **A global pause** stops the loop without touching any row, stored under the reserved `'*'` state
  key.

Runs execute in-process and failures are contained per run. The run row and `lastError` are the blast
radius, never a crashed Node.

## Sampling a published dashboard

The measure sampler runs with no client. It resolves each placed history panel's immutable dashboard
publication and its typed queries, and runs the shared Node data-source runtime under a service
principal, with the same authorization, schema, paging, completeness, and connection rules as an
interactive run. One unavailable query skips the panel with a reason. The sampler never invents a zero
or reads a renderer cache. It's one core schedule over every history panel, not a row per panel, so
turning a trend on never creates a hidden schedule.

## Observability

Every run writes a row. `schedule_runs` keeps the 20 most recent per schedule, trimmed on write, so
the table is bounded and nothing sweeps it.

<a id="what-deliberately-is-not-a-schedule"></a>
<a id="not-built-yet"></a>

## Limits

Calendar-shaped work runs as a schedule row, and anything a person might want to see, pause, or retune
is calendar-shaped. A timer whose lifetime is an object's stays on its own: the WebSocket hub sweep, the
tunnel sweep, the MCP keepalive, the terminal idle watch, and the agents plugin's sweep over its live
provider processes, whose limit is an agents setting
([operations and failure](./managed-agents/operations.md)). Startup repairs that converge to
zero stay boot-time calls, such as `pruneOrphanedGithubMirror` and the agents ledger compaction.

Unattended backup and an `agent-run` target aren't built ([proposals](./future/schedules.md)).
