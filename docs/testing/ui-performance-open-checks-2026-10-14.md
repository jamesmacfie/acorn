# UI performance checks still to run, October 14, 2026

All ten UI performance phases landed on October 13, 2026, and their plans are removed from
`docs/future`. Every phase was checked with tests in Node or jsdom, because an agent-launched desktop
window is always hidden. This page lists what a person still needs to measure. Record each result
in a dated page under `docs/testing/`.

## Phases 01 to 05: the real window

Each dated check lists its own numbers and commands:

- [Streaming replay](./streaming-replay-2026-10-13.md), the baseline for all three fixtures with
  telemetry on and off.
- [Markdown parse cost](./incremental-markdown-parse-2026-10-13.md), which also holds the incremental
  parser's design if the real window shows the cost.
- [Session revisit](./session-revisit-2026-10-13.md).
- [Idle cost](./idle-cost-2026-10-13.md).

[Streaming replay](../local-development/streaming-replay.md) explains how to run them. Compare builds
in alternating order: base, candidate, candidate, base.

## Phases 06 to 10: a working day in Sentry

Work a full day on a build with all ten phases, then compare these with the
[Sentry baseline](./sentry-baseline-2026-10-13.md).

### Git calls in checkout admission

Checkout admission keeps each repository's queue key for 60 seconds instead of running
`git rev-parse` twice per lookup.

- `git.rev_parse.count` for owner `core` must fall by at least half from 34,575.
- Process starts for owner `core`, 47,401 in the baseline.
- The medians of `/v1/p/git/tasks/:id/local/status`, 502 ms, and `/v1/core/tasks/:id/tools`, 537 ms.
  Both need to fall below 250 ms, or show fewer slow calls, because Sentry drops spans under 250 ms.
- `/v1/core/task-statuses`, 443 ms at the median, to see whether it fell too.

If the `core` count doesn't halve, look next at `repositoryMetadataKey`, which runs its own
`rev-parse` with no cache.

### Session-open timeouts

An open for a task that isn't on screen ends as `cancelled`. An open in a hidden window ends as
`ready` with `hidden: true`. A timeout carries `claimed` and `visibility`.

1. Group `agents.session.open` and `agents.sidebar.open` by `outcome`. Expect fewer timeouts and more
   `cancelled`.
2. Split every remaining `timeout` by `claimed` and `visibility`. There should be none with
   `claimed: true` and `visibility: visible`.
3. Count the `ready` spans with `hidden: true`.
4. Compare the `agents.session.open` p95 over every outcome with the p95 of `outcome: ready`, leaving
   out `hidden: true`. They should be within 20%. The baseline had 6.3 s against 1.2 s.

Judge session revisit's open times on `outcome: ready` without `hidden: true`.

### Agent process memory

The idle sweep stops idle provider processes, longest idle first, while together they hold more
than **Stop idle agents above**, 4 GB by default.

- `agent.processes.idle_past_limit` stays at zero.
- `agent.processes.memory` stays under 4 GB except while every live process is busy. Compare its p95
  and peak with 3.2 GB and 8.0 GB.
- `agent.processes.live` and `agent.processes.idle`, against 18 and 17 at peak.
- `agent.session.start` count and duration, against a day from before the change. Resumes after a
  memory stop show up as extra starts. If they become common, raise the default limit.

### Renderer memory

Nothing in the window's own data grows into gigabytes. Dashboard panel previews and GitHub job logs
leave memory soon after their screen closes, and the transcript store reports
`agents.snapshots.events`.

1. Start `pnpm dev`, and work until Activity Monitor shows the window's web content process past
   1.5 GB in the **Memory** column.
2. Right-click in the window, choose **Inspect Element**, and open **Timelines**. Record the
   **Memory** timeline for a few seconds. Write down its split into JavaScript, Images, Layers, and
   Page, and how many sessions, tasks, and terminal tabs are open.
3. In **Timelines** > **JavaScript Allocations**, take a heap snapshot.
4. Close every pane, wait one minute, and take a second snapshot. Compare the largest retainers. If
   the JavaScript heap is a few hundred MB while the footprint is over 1.5 GB, the rest is WebKit's.
5. In Sentry, compare `runtime.memory.footprint` with `runtime: renderer`. The baseline was 800 MB
   average, 1.5 GB p95, and 2.6 GB peak. The target is a p95 under 1.2 GB.
6. Check the maximum of `agents.snapshots.events`. With canonical-size sessions it stays under about
   35,000. A higher number means the store holds a session it shouldn't.
7. Check `cache.characters.max` and `cache.dehydrate` during the footprint's peak minutes, and
   whether those peaks line up with `agent.processes.memory` peaks.

### Response size

`GET /v1/core/prefs` leaves plugin state out, and the session list and search send slimmer rows.

- `api.response.bytes.max` for `/v1/core/prefs` with owner `core`. Baseline 573 KB, target under
  50 KB. Expect about 80 KB while the restore trace remains.
- `api.response.bytes.max` for `/v1/p/agents/sessions`. Baseline 474 KB average and 2.2 MB peak,
  target under 100 KB.
- `cache.characters.max`, with `cache.entries` beside it. Baseline 1.9 million, target under
  1 million.
- How often a database pane's `state.get` shows under `/v1/core/prefs` with owner `database`, and its
  size.

## Left open

- The `debug:restore-trace:*` keys keep prefs over its 50 KB target. `startupRestore.ts` marks the
  trace as temporary and writes a new key on every launch. It belongs to the dashboards-wipe
  investigation. Removing the trace and its keys brings prefs to about 40 KB.
- The `agent:session` socket frame still sends the whole session row, about 48 KB, on every change.
- The largest cache entry after prefs is a GitHub pull request, about 243 KB.
