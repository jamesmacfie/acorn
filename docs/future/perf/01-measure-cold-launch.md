# Phase 1: measure every cold launch

Date: October 19, 2026. Status: proposed.

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
