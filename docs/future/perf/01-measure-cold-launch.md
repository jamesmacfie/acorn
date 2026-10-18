# Phase 1: measure every cold launch

## Completion note

The code landed on October 19, 2026. The baseline isn't recorded. The owner records it, because it
needs a day of use on the dev app, a release build opened from Finder, and Sentry environments set in
the app. See [what the baseline must capture](#what-the-baseline-must-capture).

What changed:

- `bootTimer()` moved to `apps/node/src/composition/bootTimer.ts`. It keeps each mark and still
  prints the same `[service:boot]` line. Its first mark, `process`, runs from process start, read
  from `performance.now()`. `finish()` sends one `node.boot` span with a `node.boot.mark` child per
  mark, the shape of `helperBootSpans`.
- The collector has a one-shot hook, `whenTelemetryEnabled(run)`. It runs `run` the first time the
  preference and a sink are both on, or at once if they already are. `applyPreference` and
  `onTelemetryBatch` call it. A second `startTelemetry` forgets what's waiting.
- `beginLoginShellPath` returns the probe's promise, or null when no probe runs. `bootNode` marks
  `login-shell.settled` when it settles.
- `AGENTS_RUNTIME.reconcile` takes an optional `mark`. `ManagedAgentRuntime.reconcile` calls it after
  each of the 10 steps the plan names, and `reconcileNode` prefixes them with `reconcile.agents.`.
- The renderer reads `nodeReady()` at `tree built` and passes it to `markNodeWaited`. All four
  startup milestones carry `node.waited` when they're sent.
- The event-loop reading was in Sentry all along, under other names. A histogram reaches Sentry as
  four series, so `runtime.event_loop.max` is stored as `runtime.event_loop.max.max`, `.p95`, `.p50`,
  and `.count`. Each had about 43,690 rows over the two days before October 19. The sampler did
  start late, though. It turned the delay histogram on at its first five-second tick, so its first
  reading covered 5 to 10 seconds after the first sink subscribed. It starts the histogram at once,
  so the first window covers the boot and the start of the cleanup.
- Docs: a new [Node boot](../../telemetry/node-boot.md) page, a row in
  [Node seams](../../telemetry/runtimes.md#node-seams), `node.waited` in
  [the attribute vocabulary](../../telemetry/model.md#the-attribute-vocabulary) and
  [startup milestones](../../telemetry/renderer.md#startup-milestones), the Sentry names in
  [diagnosis](../../telemetry/diagnosis.md), and the new lines in
  [profiling](../../local-development/profiling.md#timing-a-cold-start).

Decisions and deviations:

- `reconcile.agents` keeps its total. A step's own time runs from the mark before its first
  sub-step, so the printed `(Nms)` and the span's duration both cover the whole cleanup. Its
  sub-steps are found by the `reconcile.agents.` prefix.
- The spans wait for the probe as well as the cleanup. On a small release root the cleanup can end
  before the probe settles, and `login-shell.settled` would then be missing in the one environment
  that runs the probe.
- Spans start from `performance.timeOrigin`, not from `Date.now()` at send time as the helper's do,
  so a late send doesn't shift them.
- The Node seams detail went to its own page because `runtimes.md` passed 200 lines.
- `reconcile.agents` also covers the delegation service's reconcile, which runs after `goals` and
  has no mark of its own. The gap between `reconcile.agents.goals` and `reconcile.agents` is that
  step.
- `pnpm --filter @acorn/node build` fails its service budget. It already failed on the base commit,
  6c099093c, at 1,885,773 B against a 1,884,400 B ceiling. This change adds 1,268 B, to 1,887,041 B,
  all of it code the boot has to load. The ceiling wasn't raised here.

For later phases:

- Phase 3 can read the cleanup's stalls from `runtime.event_loop.max.max` in Sentry, with the first
  window starting when the Sentry sink subscribes. It still has to line that window up with the
  cleanup, because the window is five seconds wide.
- Phase 3 reads each agents step as `node.boot.mark` with `mark:reconcile.agents.<step>`.
- Phase 2 compares where `login-shell.settled` lands before and after.

### What the baseline must capture

Follow [record the baseline](#record-the-baseline) below. It needs:

- Each `helper.boot.mark` and `node.boot.mark`, and where `login-shell.settled` lands.
- Each `reconcile.agents.<step>`.
- `renderer.boot.mark` for `script start`.
- The four startup milestones, split by `node.waited`.
- `ui.feature.open` with `first:true`, by `feature.id`, for the Agents and Git panes.
- For one cold launch per build, every `api.request` and `agents.session.open` span in its first ten
  seconds.

Record each as a median and a maximum over the runs, with the release numbers and the development
numbers kept apart. Set the Sentry **Environment** to `development` on the dev app and to
`release-local` on the release app first.

Date: October 19, 2026. Status: code landed, baseline not recorded.

This phase makes each launch report where its time went, then records a release-build baseline that
the later phases compare against. It changes measurement only. Read [the programme](./README.md)
first.

## Starting point

- The Node's boot timer, `bootTimer()` in `apps/node/src/composition/boot.ts`, prints each step to
  stderr and keeps nothing. Sentry gets those lines as logs only once the Sentry plugin's `init` has
  run. On the October 18, 2026 launch, the first line Sentry has is at +1,111 ms. `bundled-packages`,
  `migrate`, `key-check`, `graph`, and most plugin `init` lines never reach it.
- The helper and the renderer already turn their marks into spans after the fact. The helper records
  marks in `helperMark` and emits them in `helperBootSpans` (`packages/custody/src/bootMarks.ts`) the
  first time telemetry is on (`packages/custody/src/telemetry.ts`). The renderer does the same in
  `emitBootSpans` (`apps/desktop/src/client/boot.ts`).
- The `login-shell` mark records when the probe starts, not when it settles
  (`packages/node-core/src/server/core/loginShellPath.ts`). Nothing records how long spawns waited.
- `reconcile.agents` is one number. `AGENTS_RUNTIME` in `plugins/agents/src/contract/runtime.ts` has
  `reconcile(): Promise<void>` with no way to report steps. The method in
  `plugins/agents/src/server/sessions/runtime.ts` runs about ten steps.
- The renderer's startup milestones (`apps/desktop/src/client/startupMilestones.ts`) don't say whether
  the launch waited for the Node. Telling a cold launch from a reload means matching timestamps with
  `helper.boot` spans by hand.
- The owner's Sentry connection has a blank **Environment**, so every span has `environment: null`.
  The Sentry plugin sends whatever the connection's environment is
  (`plugins/sentry-telemetry/src/server/provider.ts`).
- `runtime.event_loop.max` (`packages/node-core/src/server/telemetry/runtimePressure.ts`) returned no
  rows in Sentry over two days on October 19, 2026. Whether the Node stalls during its cleanup is
  unproven.

## Changes

### Report the Node's boot as spans

1. In `bootTimer()`, record each mark's label and offset as well as printing it. Keep the printed line
   exactly as it is, because people grep for it and the profiling doc quotes it.
2. Start the record with the time before the timer started. `performance.now()` in Node counts from
   process start, so read it when the timer starts and record it as a first mark named `process`. That
   covers spawning the process and evaluating the service bundle, about 230 ms on a scratch root.
3. Emit one `node.boot` span with a `node.boot.mark` child per mark, measured from the mark before it,
   with `mark` as the only attribute. Copy the shape of `helperBootSpans`.
4. Emit them once both of these have happened: telemetry turned on, and the last `reconcile.*` mark
   was taken. `telemetryEnabled()` in `packages/node-core/src/server/telemetry/collector.ts` answers
   the first, but nothing announces when it flips. Add the smallest one-shot hook the collector needs
   for that, fired where the pref or the first sink turns collection on.
5. Add a `login-shell.settled` mark when the probe's promise settles. It lands among the other marks
   wherever it finishes, which is the point: it shows how far into the boot spawns were held.
6. Add the two span names to [Node seams](../../telemetry/runtimes.md#node-seams).

### Time the agents cleanup's steps

1. Change the capability to `reconcile(mark?: (step: string) => void): Promise<void>`. `reconcileNode`
   in `apps/node/src/composition/composition.ts` passes a function that calls its own `mark` with
   `reconcile.agents.<step>`.
2. In `ManagedAgentRuntime.reconcile`, call `mark` after each step. Use these names: `unsettled`,
   `subagents`, `steering`, `commands`, `background`, `followups`, `attachments`, `skills`,
   `webhooks`, and `goals`. A test fake that ignores the argument keeps working.
3. Keep `reconcile.agents` as the total, so older boot lines still compare.

### Say whether a launch waited for the Node

1. At the `tree built` mark in `apps/desktop/src/client/index.tsx`, read `nodeReady()`. False means
   this document drew before the Node could answer, which is a cold launch or a Node restart.
2. Pass that to the startup milestones and put it on all four as `node.waited`. Add the attribute to
   [the attribute vocabulary](../../telemetry/model.md#the-attribute-vocabulary) and to
   [startup milestones](../../telemetry/renderer.md#startup-milestones).

### Check the event loop reading

Find out why `runtime.event_loop.max` has no rows. If the sampler starts late or the sink drops it,
fix that. Phase 3 needs it to show whether the cleanup blocks requests. If it can't be fixed cheaply,
phase 3 times a request during the cleanup instead.

## Tests

- A `bootTimer` test: marks taken with telemetry off become spans once it turns on, after the last
  reconcile mark, exactly once. A boot that never turns telemetry on emits nothing.
- The printed `[service:boot]` lines are unchanged. Compare against a captured line.
- An agents runtime test: `reconcile` calls `mark` once per step, in order.
- A startup milestones test: `node.waited` is true when `nodeReady()` was false at `tree built`.

## Record the baseline

Do this once the changes above are merged, before any later phase lands. Write the results to a new
evidence page in `docs/testing/` named for the date, and list it in [the index](../../README.md).

1. On the dev app, set the Sentry connection's **Environment** to `development`. Use the app for one
   working day. Restart it at least five times with the window visible.
2. Build a release app with `pnpm dist`. The app lands in
   `apps/desktop/src-tauri/target/release/bundle/macos/`.
3. Open the release app from Finder. It keeps its data in
   `~/Library/Application Support/com.acorn.desktop/node`, separate from the dev app's, so the first
   launch runs onboarding. Add this checkout as a project, connect GitHub, and start two agent
   sessions so the Agents pane has something to open.
4. In the release app, configure the Sentry export with **Environment** set to `release-local`, and
   turn telemetry on.
5. Quit and reopen the release app five times from Finder, with its window in front. Leave each launch
   for 60 seconds before you quit with Command-Q.
6. Run it once from a terminal as `ACORN_PERF=1 .../acorn.app/Contents/MacOS/acorn-desktop`. The
   helper and the Node print their boot lines there. The build still runs the login-shell probe,
   because the probe depends on the build being packaged, not on how it was started.

Record these, each as a median and a maximum over the runs:

- Each `helper.boot.mark` and `node.boot.mark`, and where `login-shell.settled` lands.
- Each `reconcile.agents.<step>`.
- `renderer.boot.mark` for `script start`, which is the release renderer's fetch and evaluation time.
- The four startup milestones, split by `node.waited`.
- `ui.feature.open` with `first:true`, by `feature.id`, for the Agents and Git panes.
- For one cold launch per build, every `api.request` and `agents.session.open` span in its first ten
  seconds, so phase 3 knows which request the Agents pane waited on.

Keep the release and development numbers apart. The release root is small and the development root
is the owner's real one, so neither alone describes an installed copy that has been used for weeks.
The release runs show the costs only a packaged build pays. The development runs show what the data
costs.

## Acceptance

- Sentry shows `node.boot` with every mark from `process` to `reconcile.agents.goals` for a launch
  in each environment.
- `renderer.startup.usable` can be filtered by `node.waited` and `environment`.
- The evidence page exists, is listed in the index, and holds every figure above.

## Risks

- A release build registers its MCP server under its packaged name in the owner's Claude Code and
  Codex config, as any installed copy does. Remove the release data folder and those entries when the
  programme ends, if the owner doesn't want them.
- Don't copy the owner's data root into the release app's data folder. Its cleanup would act on the
  same worktrees and agent sessions as the dev app.
