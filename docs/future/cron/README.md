# Schedules: periodic work, owned by the node

**Unbuilt.** One scheduler in the node process, three parties allowed to put work on it — core,
plugins, and the user — and a budgeted vocabulary for saying *when*. This folder is the design and
the build order; nothing here is speculative machinery, every piece is pulled in by a named use
case below.

**This work precedes the dashboard upgrade.** The accepted dashboard redesign
(`docs/future/dashboards/README.md`) needs measure history, and measure history sampled only while
someone happens to have a dashboard open is a chart full of holes. The scheduler is what makes it
gapless, so `docs/future/dashboards/measure-history.md` now names this folder as its foundation and
the dashboards build order starts here.

## Why the node, and only the node

A schedule is a promise to run when nobody is looking. Clients close, hide, sleep; the node is the
long-lived process (Electron main's node, or the standalone node) and it is where the mirrors, the
prefs, the plugin routes and the storage already live. So: **one scheduler, node-side; no client
ever owns a timer that fires work.** Client-side polling (panel refresh, chrome revision) stays
what it is — freshness for a person who is present — and is not this system. The two must not be
confused: a panel poll is "I am looking at this"; a schedule is "do this whether or not anyone is".

The node is single-user (`node-core/server/db/schema.ts` — newer app-state tables are
machine-scoped), which spares this design a tenancy axis: schedules are machine-scoped, and "the
user" means the node's owner.

## The three declarers, one registry

| Owner | Declared how | Examples |
| --- | --- | --- |
| **core** | registered at boot in `main/bootstrap.ts`, code-defined | measure sampling, history compaction, audit pruning, backup |
| **plugin** | loaded: manifest `contributions.schedules` (a descriptor, like `collections`); compiled: `ctx.schedules.register(...)` on the node-side plugin context | mirror refresh on the plugin's own rate budget, token refresh, usage snapshots, cache eviction |
| **user** | created from the client through a core route, targeting things that are *schedulable* | run a node action nightly; later, run an agent workflow (reserved) |

All three land in **one registry with one key format** — `core:<id>`, `<pluginId>:<scheduleId>`,
`user:<uuid>` — and one settings surface lists them all with owner badges, last/next run, pause and
run-now. Declared schedules (core, plugin) are **registry-truth**: the code or manifest is the
definition, the database stores only overrides and run state, so disabling a plugin removes its
schedules the way it removes its routes. User schedules are **database-truth**: full rows, parsed
tolerantly, unknown kinds retained inert — the dashboards persistence rules, applied verbatim.

## The use cases this is sized against

Named so the budget arguments below have referents; the first two are why this folder exists.

1. **Dashboard measure sampling** (core) — hourly, reads every panel that asked for a history
   trend, records one number per panel (`../dashboards/measure-history.md`). The driver.
2. **History compaction and retention** (core) — measure-history's own maintenance job.
3. **Plugin data refresh on the plugin's own budget** (plugin) — e.g. linear revalidating its
   issue mirror every ten minutes server-side, so samples and panels read fresher data without a
   client polling. Deliberately the *plugin's* choice: freshness stays plugin-owned
   (`docs/dashboards.md § Freshness`), and the github rate-limit stance survives (below).
4. **Credential upkeep** (plugin) — refreshing expiring integration tokens before they expire
   rather than on the first failing request.
5. **Node housekeeping** (core) — audit-log pruning, backup (`main/backup.ts`), blob/cache
   eviction: things that run on intervals today only if some code path happens to trip them.
6. **Usage snapshots** (plugin) — the agent-usage read model's account-level collection becomes a
   visible schedule row instead of an invisible interval.
7. **User automation over node actions** (user) — "prune merged worktrees nightly", "run the
   repo's build check every morning": `runNodeAction` targets with the risk-tier consent taken at
   creation.
8. **Scheduled agent workflows** (user, **reserved**) — "every weekday at 9, run an agent over
   this repo to triage failing CI". Reserved as a target kind in the vocabulary now, gated on a
   headless agent runtime existing at all (`targets.md § agent-run`).

## Invariants

- **The plugin wire contract grows by exactly one descriptor kind** (`schedules`, capped at 4) and
  one node-context registry. No new client bundle surface, no client-side plugin timers, ever — a
  plugin that wants periodic client code is asking to run code while the user isn't looking, in
  the process the user is looking at.
- **A scheduled run renders nothing and asks nothing.** No UI, no prompts, no focus. Consent for
  risky work is taken **when the schedule is created**, once, armed — because 3am cannot answer a
  confirmation strip, and a schedule that prompts is an alarm clock, not automation
  (`targets.md § consent`).
- **Cadence is a budgeted vocabulary, not a language**: `{ every: seconds }`, `{ daily: "HH:MM" }`,
  `{ weekly: { day, at } }`, node-local time. Five-field cron syntax is refused — it is a language
  to parse, explain, and debug, and none of the eight use cases needs "the last Friday of the
  month". Additive later at the cost of arguing for it.
- **No backfill, ever.** A schedule missed while the node was off runs **once** on catch-up, then
  resumes its cadence from now. Replaying a week of missed hourly samples would fabricate history
  the node did not witness — worse than the gap, which is honest (`engine.md § catch-up`).
- **Scheduling never overrides freshness ownership.** A sampling run records what the node's
  mirrors know; it does not force revalidation. GitHub's deliberate no-unattended-revalidate
  stance (`docs/dashboards.md § Freshness`) survives intact: a plugin that wants fresher unattended
  data declares its *own* refresh schedule against its own rate budget (use case 3), and the
  sample's honesty ceiling is the mirror's age (`targets.md § collection-sample`).
- **Runs are observable or they didn't happen**: every run writes a status row (capped ring per
  schedule), failures surface in the settings list and never retry hot (`engine.md § backoff`).

## Refused, on the record

- **Cron expressions** — above. Revisit if a real use case needs calendar shapes the three forms
  cannot express.
- **A client-side scheduler or "background" client mode** — the node exists; two schedulers is a
  synchronization problem wearing a feature's name.
- **Backfill / catch-up replay** — above; fabricated history.
- **Per-run confirmation for risky targets** — consent moves to creation; a schedule whose every
  run needs a human is a button, and buttons exist.
- **Plugin-scheduled work outside its own confinement** — a plugin schedule may only hit the
  plugin's own confined routes (loaded) or its own registered handler (compiled), the same rule as
  every other descriptor. No schedule targets another plugin's anything.

## Build order

| Phase | What | File |
| --- | --- | --- |
| 1 | The engine: tables, registry, tick loop, policies (catch-up, jitter, backoff, timeout, concurrency), boot wiring, core routes, settings surface | `engine.md` |
| 2 | Declarations: the manifest descriptor + trust projection, `ctx.schedules` node-side, override model, lifecycle rules | `declarations.md` |
| 3 | Targets: `collection-sample` (with its two prerequisite seams: the node-side collection read registry and the shared measure pipeline), `plugin-run`, `node-action` with creation-time consent | `targets.md` |
| 4 | Migrate the invisible intervals onto rows (backup, audit pruning, usage collection) — deletion of bespoke timers, not new features | `engine.md § migration` |

Phases 1–2 unblock the dashboards work: `../dashboards/README.md`'s build order now begins with
this folder, and `../dashboards/measure-history.md § Sampling` is written against phase 3's
`collection-sample` target.

## Reading order for a fresh session

1. This file, for the shape and the budget arguments.
2. [`engine.md`](./engine.md) — storage, policies, routes.
3. [`declarations.md`](./declarations.md) — how plugins say "I have periodic work".
4. [`targets.md`](./targets.md) — what a schedule may do, including the reserved agent-run kind.
5. `../dashboards/measure-history.md` — the first consumer, updated to build on this.

Every file ends with a **verify before building** list; budget a re-verify pass, not a rewrite.
