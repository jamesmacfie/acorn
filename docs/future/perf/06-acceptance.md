# Phase 6: accept the work and update the docs

Date: October 19, 2026. Status: proposed. Needs phases 1 to 5.

This phase repeats phase 1's baseline on the finished checkout, compares the two, and moves what
shipped into the reference pages. Read [the programme](./README.md) first.

## Run the comparison

1. On the same machine as phase 1's baseline, build the release app from the final checkout with
   `pnpm dist`.
2. Repeat every step in [record the baseline](./01-measure-cold-launch.md#record-the-baseline), in
   the same order, with the same release data folder and the same dev data root.
3. Use the dev app for one working day, as the baseline did. Compare a working day with a working
   day, because an idle evening pulls every percentile down.
4. Watch Sentry for one working week after that. Filter on `node.waited:true` and
   `visibility:visible`, and split by `environment`.

## Record the evidence

Write a new evidence page in `docs/testing/` named for the date, and list it in
[the index](../../README.md). For each figure in phase 1's page, give the before, the after, and the
change. Then say, for each target in [the programme](./README.md#what-the-programme-delivers),
whether it was met:

- `renderer.startup.usable` on cold launches, at the median and the 95th percentile.
- `ui.feature.open` timeouts in the first minute after a cold launch.
- The Node listening, measured from the helper's ready line.

Explain any target that was missed and what holds it. Don't edit phase 1's page. It's dated evidence.

## Update the reference pages

Each page below owns behavior a phase changed. Describe the behavior as it is. Leave the history to
git.

- [Profiling](../../local-development/profiling.md): the `node.boot` spans, the `process` and
  `login-shell.settled` marks, the `reconcile.agents.<step>` lines, and the shell's `[shell:boot]`
  lines if phase 5 added them.
- [Boot order](../../node-distribution.md#boot-order): the cached login-shell `PATH`, and when a
  fresh one reaches spawns.
- [Node seams](../../telemetry/runtimes.md#node-seams): `node.boot` and `node.boot.mark`.
- [Startup milestones](../../telemetry/renderer.md#startup-milestones) and
  [the attribute vocabulary](../../telemetry/model.md#the-attribute-vocabulary): `node.waited`.
- [Process startup and teardown](../../managed-agents/operations.md#process-startup-and-teardown):
  the cleanup's steps, that it yields to requests, and that writes wait for it.
- [Query startup and bytes in Sentry](../../local-development/profiling.md#query-startup-and-bytes-in-sentry):
  the filters for cold launches and for release builds.

Then run `pnpm --filter @acorn/site stale --touching` with the changed paths, as
[writing docs](../../writing-docs.md#when-the-public-site-cites-your-doc) describes, and update any
public page it lists.

## Close the programme

1. Trim each phase page to a short completion note: what landed, and anything left open. The
   [node tray phases](../node-tray/07-keep-awake.md) show the shape.
2. Change this programme's status in [the future index](../README.md).
3. If the owner doesn't want the release build's data, remove its data folder and its MCP entries,
   as phase 1's risks describe.

## Acceptance

- The comparison page exists, is listed, and covers every figure in phase 1's page.
- Every reference page above describes the shipped behavior.
- `pnpm --filter @acorn/arch-tests test` passes.
