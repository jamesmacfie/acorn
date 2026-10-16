# Measure where slow requests spend their time

Date: October 16, 2026. Status: implemented October 16, 2026, on branch `perf-3`. The day of Sentry
acceptance queries in [accept the work](#accept-the-work) remains open. Starting point: `main` at
afda2b53f.

What shipped differs from the plan in five places:

- The renderer keeps one suspend timestamp in the emitter rather than two counters in
  `responsiveness.ts`, because the emitter can't import that module without a cycle. The Node does the
  same with the sampler's last suspend time, so every span, including `http.request` and `hook.run`,
  is checked without a snapshot at its start.
- A usage read that joins another read's refresh raises its own `agents.usage.wait` span. A plugin
  can't add an attribute to the core request span.
- Archiving also has a `hooks` phase for `core:task-archiving`. Hook chains start their own trace, so
  `hook.run` spans don't nest under the phase as the plan expected.
- `ui.render`'s 30-second deadline gets the same late-timer cap as `ui.feature.open` and the agent
  view opens.
- GitHub, Linear, and Rollbar get their telemetry handle at init through a setter in each plugin's API
  module, because those modules have no `ctx` in reach. GraphQL operations are named by the
  document's first field.

This plan adds the measurements that would answer the performance questions Sentry can't answer
today. Read it before you add a span, a histogram, or an attribute to the Node or the renderer. It
changes measurement only. Fixing the slow paths it exposes is separate work, listed at the end.

## Why

Seven days of Sentry data, read on October 16, 2026, show two problems.

Slow Node requests have nothing inside them. The six slowest `http.request` spans each have zero
child spans, so their whole duration is unexplained:

| Route | Duration | Date |
| --- | ---: | --- |
| `/v1/p/agents/usage` | 965 s | October 14 |
| `/v1/core/tasks/:id/tools` | 253 s | October 12 |
| `/v1/core/tasks/:id/archive` | 147 s | October 13 |
| `/v1/p/docker/task-summary` | 65 s | October 15 |
| `/v1/p/git/tasks/:id/local/dependencies` | 63 s | October 13 |
| `/v1/p/github/repos/*` | 60 s | October 13 |

The Git histograms hint at the cause without proving it. The slowest `git.rev_parse` for owner
`core` took 252,674 ms, within a tenth of a second of the 253-second `/tools` request. The slowest
`git.fetch` for owner `github` took 60,010 ms, the same as the `/github/repos/*` request. A
histogram carries no trace, so Sentry can't connect them.

Sleep and hidden windows distort the renderer's numbers. `ui.feature.open` should end at 30 seconds,
but its longest span lasted 20 minutes. One `nav.change` lasted 4.9 hours, and one `api.request`
7.3 hours. These outliers push the `ui.render` 95th percentile to 30 s and
`renderer.startup.usable` to 31.7 s. While such a span stays open, every background request joins
its trace. One trace holds 114 `/v1/core/tasks` requests.

The busiest slow routes over the same week, from `http.request` spans:

| Route | Calls | p50 | p95 |
| --- | ---: | ---: | ---: |
| `/v1/core/task-statuses` | 8,274 | 432 ms | 1.3 s |
| `/v1/p/docker/task-summary` | 7,700 | 393 ms | 2.4 s |
| `/v1/p/git/tasks/:id/local/status` | 7,452 | 401 ms | 2.8 s |
| `/v1/core/tasks/:id/tools` | 2,832 | 679 ms | 7.0 s |
| `/v1/p/agents/usage` | 1,510 | 217 ms | 9.3 s |

These counts are slow calls, not totals. The Sentry sink drops a fast request span that's alone in
its trace (`sentrySpans` in `plugins/sentry-telemetry/src/server/envelope.ts`). The earlier numbers
are in the [Sentry baseline](../testing/sentry-baseline-2026-10-13.md).

## Goals

- A slow Node request names the Git command, process, or SQL statement that held it.
- A span that crossed a sleep or a hidden window says so, so it can be filtered out of latency
  numbers.
- The four slowest routes above can be split into their steps.
- "Is it Acorn or the Mac?" has an answer in Sentry.

Not goals: a profiler, an OpenTelemetry SDK, per-call spans on hot paths, or any change to what
leaves the machine.

## Rules every item follows

Each item stays inside the [telemetry model](../telemetry/model.md):

- A span must pass [the admission rule](../telemetry/model.md#the-admission-rule-for-a-span):
  request-shaped, fewer than about ten a second, and one name for a hundred instances. Hot paths
  stay histograms. Item 1 is the one deliberate exception, and it's bounded.
- No paths, arguments, query text, prompt text, branch names, or file contents in attributes. An id
  is an attribute, never part of a name.
- Telemetry off costs one boolean read. Build no attribute object before you check the switch.
- A throw inside instrumentation never reaches the measured code.
- Each change updates its owning reference page in the same commit: the
  [Node seams table](../telemetry/runtimes.md#node-seams), the
  [renderer seams table](../telemetry/renderer.md#renderer-seams), or
  [diagnosis](../telemetry/diagnosis.md).

## The work

The items are in priority order. Items 1 and 2 matter most. Each one ships on its own.

### 1. Sample slow calls as child spans on the Node

`measure()` in `packages/node-core/src/server/telemetry/collector.ts` feeds a histogram and nothing
else. The Git, process, and SQL seams all use it (`server/core/git.ts`, `server/core/proc.ts`, and
`server/storage/sqlite.ts`).

The renderer already solves this. Its `measure()` in
`packages/client-core/src/infra/telemetry/emitter.ts` also emits a span for a call of 100 ms or
more, with `slow: true`, up to 20 per flush window. Copy that rule into the Node's `measure()`:

- At 100 ms or more, and under 20 samples in this flush window, emit a span named for the seam,
  such as `git.rev_parse` or `proc.spawn`. Copy the histogram's labels onto it and add `slow: true`.
- Parent it on the ambient context (`currentTelemetryContext()`), the way `startSpan` does. With no
  ambient context, emit no sample. The histogram still counts the call.
- Reset the sample count where the flush resets histogram state.
- Keep the histogram exactly as it is. The span is an extra sample, not a replacement.

Update [the admission rule](../telemetry/model.md#hot-seams-are-metrics) to state this bounded
exception for both runtimes.

Check it with a unit test that a 150 ms measured call inside `runWithTelemetry` emits one child span
with the parent's trace and span ids. A 50 ms call must emit none, and the 21st slow call in one
window must emit none. In Sentry, the slowest `/v1/p/git/tasks/:id/local/status` traces show
`git.*` children.

The Sentry sink keeps a request span whenever another span shares its trace. These samples will keep
some fast request spans that are dropped today. The 20-per-window cap bounds that at about 240
samples a minute.

### 2. Mark spans that crossed a sleep or a hidden window

Three changes, one per runtime and one for deadlines.

**Renderer: a `suspended` attribute.** `packages/client-core/src/infra/telemetry/responsiveness.ts`
already runs a one-second timer for `ui.event_loop.delay` and listens for `visibilitychange`. Keep
two module counters there: how many times the document went hidden, and how many timer gaps exceeded
five seconds. Each span snapshots both counters at its start. At its end, a span whose counters
moved gets `suspended: true`. Do this once, in the emitter's span constructor, so every renderer
span gets it.

**Deadlines that fire late.** The 30-second limits are `setTimeout` calls, in
`packages/client-core/src/infra/telemetry/featureOpening.ts` (`OPENING_TIMEOUT_MS`) and in
`plugins/agents/src/client/sessions/agentTelemetry.ts`. A sleeping Mac or a throttled hidden window
delays the timer, and the span then records the whole gap. When the timer fires more than five
seconds late, end the span with `outcome: 'timeout'`, `late: true`, and its duration capped at the
deadline. That needs an optional end-time argument on the client `SpanHandle.end`.

**`nav.change` in a hidden window.** `packages/client-core/src/features/tasks/pageChange.ts` ends the
span on the second animation frame. A hidden window runs no frames, so the interaction stays open for
hours and every request joins it. End it with `outcome: 'hidden'` when the document goes hidden.
Also end it at 30 seconds with `outcome: 'timeout'` if no frame arrives.

**Node: a `suspended` attribute.** `packages/node-core/src/server/telemetry/runtimePressure.ts`
already detects a suspend in each five-second window. Keep a running total of suspended milliseconds
in the collector. Every Node span snapshots it at start and compares it at end, setting
`suspended: true` when it moved. The helper shares this sampler (`packages/custody/src/telemetry.ts`).
A span that ends inside the window where the suspend happened misses it. Write that limit down
rather than polling faster.

Update [diagnosis](../telemetry/diagnosis.md) to say: filter `suspended:false` before you quote a
latency.

To check it, use fake timers. Advance past the deadline by 60 seconds, then check the duration is
capped and `late` is set. Fire `visibilitychange` during a span, then check `suspended`. In Sentry,
the `ui.feature.open` maximum with `suspended:false` stays near 30 s.

### 3. Time each plugin's tool availability check

`GET /v1/core/tasks/:id/tools` in `packages/node-core/src/server/routes/plugins/agentTools.ts` asks
each tool's `when` check in turn, cached per check for the request (`available()`). None is timed.
The route's 95th percentile is 7.0 s, and its slowest call took 253 s.

On a cache miss, wrap the check in `startSpan(agentToolOwner(tool.name), { name: 'tool.availability' })`.
Give it the attributes `tool` and `available`. A tool's check runs once per request, so this adds at
most one span per plugin check.

Do the same for the archive dialog's plugin checks in
`packages/node-core/src/server/pluginHost/taskChecks.ts`, as `task.check` owned by the plugin.

The test: a route call with two tools sharing one `when` emits one span. In Sentry,
`span.op:tool.availability` grouped by `owner` names the slow plugin.

### 4. Time each account's plan usage check

`refresh()` in `plugins/agents/src/server/usage/service.ts` runs every harness's collector for every
account in parallel. Nothing inside it is timed. `/v1/p/agents/usage` has a 95th percentile of
9.3 s, and one call took 16 minutes.

Wrap each `target.entry.collect(...)` in `ctx.telemetry.startSpan('agents.usage.collect')`, with the
attributes `provider`, `account`, and `outcome`. A read that waits on another read's refresh
(`inFlight`) should mark its request span `joined: true`, because chained waits are a possible
cause.

The account name is a folder name the person chose, such as `work`. It isn't the person's identity,
which [the model](../telemetry/model.md#what-never-leaves-the-machine) withholds. Confirm this
reading with James before shipping. If he disagrees, send the account's position in the list
instead.

### 5. Split task archiving into phases

`archiveTask` in `packages/node-core/src/server/storage/archive.ts` has no spans. One archive took
147 seconds on October 13, 2026.

Copy the task preparation pattern (`packages/node-core/src/server/worktrees/preparationTelemetry.ts`).
Use a `task.archive` span with `task.id`, and `task.archive.phase` children labelled by `phase`:

| Phase | Where in `archiveTask` and `archiveClaimedTask` |
| --- | --- |
| `admit.wait` | `admitWork`, waiting for the repository |
| `worktree.wait` | `waitForTaskWorktreeCreation` |
| `teardown` | `runTeardown` |
| `checks` | `applyTaskChecks` |
| `worktree.aside` | `setWorktreeAside` |
| `sessions.drop` | `dropTaskSessions` |
| `worktree.discard` | `discardWorktree` |

Hooks such as `taskArchiving` already emit `hook.run` and nest under the phase that calls them.

To check it, archive a task in a test and assert one `task.archive` span with a phase child for each
step that ran. A failed teardown marks its phase `error`.

### 6. Record when the client gave up

In three of the six slow traces, the renderer's `api.request` ended at its 30-second limit while the
Node kept working for 63 to 147 seconds. Nothing records that the answer went nowhere.

In `requestIdMiddleware` (`packages/node-core/src/server/respond.ts`), read the request's abort
signal, `c.req.raw.signal`. If it aborted before the handler finished, add `client.gone: true` to the
`http.request` span. First confirm the signal fires under the `@hono/node-server` listener in
`packages/node-core/src/server/transport/listener.ts` when the client closes the socket. If it
doesn't, listen for `close` on the raw response through the listener's bindings.

The test: abort a fetch to a route that sleeps, and assert the span carries `client.gone`. This item
only measures the problem. Cancelling the work is a separate change.

### 7. Time waits for the repository lock

`admitWork` in `packages/node-core/src/server/core/checkoutAdmission.ts` waits on the previous
operation for the same repository (`await before`) and records nothing. Emit a
`checkout.admission.wait` span only when the wait lasts 10 ms or more, with `owner` from the ambient
context. Without it, a request queued behind another task's `git worktree add` looks like slow Git.

### 8. Record the Mac's overall load

`runtimePressure.ts` measures only Acorn's own process. On October 14, 2026, the slowdown was 18
type-check processes and nearly full swap, and Sentry couldn't show it. Every five seconds, add two
gauges: `host.load.1m` from `os.loadavg()[0]`, and `host.memory.free` from `os.freemem()`. Attach
`host.cpus` to the first. Read swap with `sysctl vm.swapusage` once a minute at most, and only on
macOS, because it spawns a process.

### 9. Time calls to GitHub, Linear, and Rollbar

The `fetch` calls in `plugins/github/src/server/githubApi.ts`, `plugins/linear/src/server/index.ts`,
and `plugins/rollbar/src/server/index.ts` aren't timed. GitHub allows 5,000 requests an hour, about
1.4 a second, so a span per call fits the admission rule.

Emit `<service>.api` spans, such as `github.api`, through `ctx.telemetry.startSpan`. Give them
`method`, `status`, and an `operation` name from a fixed list per plugin. Never send the URL, which
holds repository and issue names. For GitHub, also add `ratelimit.low: true` when
`x-ratelimit-remaining` is under 10% of `x-ratelimit-limit`.

The Git fetches behind `/v1/p/github/repos/*` are Git commands, not HTTP. Item 1 covers them.

### 10. Split agent turn time into its waits

`beginTurnSpan` in `plugins/agents/src/server/sessions/runtimeEngine.ts` measures a whole turn. Add
two attributes when the turn ends:

- `first_output.ms`: from turn start to the provider's first output event.
- `approval.wait.ms`: total time the turn waited for a person's permission answer.

These keep a slow provider apart from a person who didn't click **Allow** for two minutes. They're
attributes on the existing span, so no new span is needed.

## Later, only when a question needs them

- Node startup. The steps in `apps/node/src/composition/boot.ts` print to stderr only. Send them
  retroactively once telemetry starts, the way `renderer.boot` does, with one mark per plugin init.
- The browser extension, which records nothing.

## Accept the work

Work a full day on a build with these changes, then run these queries in Sentry. Org `acorn-u3`,
project `acorn-development`, period 24 hours. Record the results in a dated page under
`docs/testing/`:

1. The 10 slowest `http.request` spans. Each one over 1 s has at least one child span, or
   `suspended: true`.
2. `ui.feature.open`, `agents.session.open`, and `nav.change`, maximum duration with
   `suspended:false`. Each stays under 31 s.
3. `span.op:tool.availability` grouped by `owner`, and `span.op:agents.usage.collect` grouped by
   `provider`. Both return rows.
4. `client.gone:true` count, grouped by `route`.
5. `host.load.1m` beside `ui.stall` over the day.

`pnpm lint` and the touched packages' tests pass, and `pnpm --filter @acorn/arch-tests test` passes
for the doc changes.

## Risks and open questions

- **Sentry volume.** Item 1 adds up to 20 spans per five seconds and keeps some request spans that
  are dropped today. Watch `sentry.dropped` for a day. If the cap is too high, lower it to 10.
- **Account names in Sentry.** Item 4 needs a decision.
- **Suspend detection is coarse.** It works in five-second windows on the Node and one-second ticks
  in the renderer. A span shorter than a window can miss a suspend. That's acceptable, because the
  distorted spans are minutes long.
- **The 252-second `git rev-parse` may itself be a sleep.** Item 2 is what tells that apart, so
  don't start fixing the `/tools` route until item 2 ships.

## Problems found, for separate work

The same Sentry week shows these, which more measurement won't fix:

- The Node keeps working after the client has given up, for up to 147 s.
- Agent provider processes peaked at 12.5 GB against the 4 GB default limit, and
  `agent.processes.idle_past_limit` reached 4. The idle stop missed processes.
- The Node's event-loop 95th percentile peaked at 35 s. Confirm whether that was a suspend once item
  2 ships.
- `ACORN-DEVELOPMENT-8`, "Cron failure: workflows-triggers", has 215 events.

## Query Sentry from an agent session

A Claude session on a harness account reads only its own folder's `.claude.json`
([harness accounts](../managed-agents/accounts.md)). Add Sentry to each account with
`CLAUDE_CONFIG_DIR=<account folder> claude mcp add --scope user --transport http sentry https://mcp.sentry.dev/mcp`.
Then sign in once per account with `/mcp` in an interactive `claude`. Start a fresh session after,
because a running session doesn't load the server. Group process starts by `file`, not by `binary`.
