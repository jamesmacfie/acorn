# Phase 3: say when data changed

Date: October 20, 2026. Status: proposed. Needs nothing. Can run beside phases 1 and 2.

## Goal

A plugin can tell the Node that a source's records changed, and the scheduler can run a job early
without breaking its own rules. Phase 4 uses both so a record trigger fires within seconds instead of
on its next check.

This phase adds no trigger. It adds a signal and a scheduler method, with first emitters wired where a
plugin already knows the moment its data changes.

## Starting point

- `ctx.dataSources` in `packages/plugin-types/src/contracts/context.ts` can register, discover, list,
  invoke, and resolve. Nothing says a source's records changed.
- Plugins announce changes on their own verbs, such as GitHub's `pulls-changed` and `pr-synced` and
  the workflows plugin's `run-changed`. Each verb has its own payload, and a listener has to know
  which verb belongs to which source.
- Core events are listed in `NODE_EVENT_CHANNELS` in `packages/protocol/src/transport/nodeEvents.ts`
  ([events](../../plugins/events.md)).
- A derived source declares its inputs by `<pluginId>:<sourceId>`
  ([derived sources](../../data-sources/derived-sources.md)), so the host knows which derived sources
  read a given source.
- `Scheduler.runNow` in `packages/node-core/src/server/schedules/scheduler.ts` throws when the job is
  already running or when four jobs are running. `ScheduleRunReason` is `due`, `manual`, or
  `catch-up`. The workflows plugin reaches the scheduler through the `WorkflowScheduleScheduler`
  type passed in `deps.scheduler`.

## The design

### The signal

Both plugin tiers get one method:

```ts
ctx.dataSources.changed(sourceId: string, hint?: { connectionId?: string }): void
```

- The host binds the calling plugin's ID. A plugin can only say its own sources changed, including
  ones it discovered.
- It's fire and forget. It never throws for an unknown source. It logs once and drops the call, so a
  plugin can call it from a mirror write without guarding.
- The Node coalesces calls per source to one publish a second.
- Core publishes `data-source:changed` with `{ pluginId, sourceId, connectionId? }`. Like every core
  event, the payload says what to read again and carries no records.
- For each derived source that declares the changed source as an input, core publishes
  `data-source:changed` for the derived source too, one level at a time, at most two levels deep, as
  the input rules allow.

A loaded plugin reaches it through the worker RPC like the other `ctx.dataSources` calls. Add it to
the loaded call modes in `packages/node-core/src/server/plugins/hostCallModes.ts`.

### The scheduler's wake

```ts
scheduler.wake(key: string, options: { minGapMs: number }): void
```

- If the job isn't running, the scheduler moves its next run to the later of now and its last finish
  plus `minGapMs`, then rearms its one timer.
- If the job is running, the scheduler sets a follow-up flag. When the run finishes, the job runs once
  more, at the same gap. Any number of wakes during one run cause one follow-up.
- The global cap of four still holds. A woken job past the cap stays due, as any due job does.
- A paused scheduler, a disabled job, or a job in backoff ignores the wake. Backoff exists so a
  failing provider isn't hammered, and a wake mustn't defeat it.
- The run records the reason `wake`, and Settings → Schedules shows it in the run ring.

`WorkflowScheduleScheduler` gains `wake`. `runNow` keeps its meaning: a person asked, and gets an
answer.

### First emitters

Each emitter is one line at a point where the plugin already announces a change:

| Plugin | Source | Where |
| --- | --- | --- |
| GitHub | `pull-requests` | Beside `pulls-changed` and `pr-synced` in `plugins/github/src/server/routes/pulls/pullRefresh.ts` and `createPull.ts` |
| Workflows | `runs` | Where a run's status changes, beside `run-changed` |
| Agents | `sessions` | Beside `sessions-changed` |
| Core | `tasks` | Where core publishes `tasks:changed` |

GitLab, Bitbucket, Linear, and Rollbar wait for phase 6. Linear and Rollbar have no mirror, so their
triggers rely on the cadence until webhooks arrive through the Cloud relay.

## Steps

1. Add `data-source:changed` to `NODE_EVENT_CHANNELS`, with its payload type.
2. Add `changed` to the plugin context types, the compiled and loaded hosts, and the call modes, with
   coalescing and the derived fan-out in `packages/node-core/src/server/dataSources/`.
3. Add `wake` and the `wake` run reason to the scheduler, with tests for each rule above using the
   scheduler's fake clock.
4. Wire the first emitters.
5. Document the signal in [typed data sources](../../data-sources.md), the event in
   [events](../../plugins/events.md), and `wake` in [schedules](../../schedules.md#policies).

## Acceptance

- A loaded plugin that calls `changed` for another plugin's source is refused and logged, and its own
  call publishes one event.
- Ten calls within a second publish one event.
- A change to `linear:issues` publishes for a derived source that reads it.
- A wake during a run causes exactly one follow-up run. A wake during backoff causes none.
- With a `pnpm dev:agent` session, refreshing a pull request in the GitHub pane publishes
  `data-source:changed` for `github:pull-requests`, visible to a test subscriber plugin.
