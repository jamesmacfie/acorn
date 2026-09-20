# Slice 17: Scheduling, activation, and change review

Date: 2026-09-20. Status: implementation complete; real-host acceptance partial.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-running.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 13, 16. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A user schedules the published Linear workflow, chooses first-check behavior, and understands why a later occurrence is skipped.

## Work

1. Add cadence, timezone, project, and typed input setup using the existing workflow entry.
2. Reveal repeat policy/selected fields only for relevant loops and gate checkpoint choices by source capability.
3. Show first-check choice, next three execution times, and effective limits in activation review.
4. Add Active/Paused/Needs review/Unavailable states and direct repair links for changed dependencies and expired continuation.
5. Keep retained history as the default and expose fresh-start consequences only in the relevant review. Distinguish pause, cancellation, Run now, and deletion.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Real-window and terminal checks cover first activation, failed baseline, changed shared query, retained history, overlapping approval wait, timezone change, and paused Run now. Test no activation is queued while offline.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Implemented on September 20, 2026.

- The schedule editor starts from a published database workflow and keeps scheduling out of ordinary
  workflow creation. It sets project, typed inputs, cadence, and IANA timezone; shows the next three
  concrete checks with offsets; reviews effective limits and first-check behavior; and progressively
  reveals repeat fields and capable-source checkpoints only for record loops.
- The Node-facing read model exposes Draft, Activating, Active, Paused, Needs review, and Unavailable
  without exposing graph digests, processing epochs, continuation tokens, or occurrence request keys.
  Publication marks affected schedules for review while retaining their approved graph and history.
- Pause, active-run cancellation, **Run now**, and deletion remain separate actions. Saving creates a
  disabled draft; activation is an immediate device mutation and has no offline queue. History is
  retained unless the owner opens **Advanced change review** and explicitly chooses **Start fresh**.
- The focused workflow run passed 56 tests in seven files across the server model, service, routes,
  client model, dialog, editor, and publication. It covers baseline failure, changed publication,
  retained versus fresh history, gated overlap, paused **Run now**, checkpoint refusal, timezone/DST
  calculation, and offline activation refusal.
- The focused scheduler run passed 17 tests. The focused terminal kit/plugin/chrome run passed 162
  tests with two fixture skips, and the architecture suite passed 63 tests. Workflows, Node, and
  terminal type checks passed. The full `pnpm lint` gate completed all 33 package checks with only
  the repository's existing oxlint warnings; `pnpm db:check` applied every chain, including workflow
  migration 0009, to a fresh database.
- A real isolated Tauri session published a workflow, opened **Schedule…**, reviewed three GMT+12
  occurrences and effective limits, activated it, paused it, and started **Run now** while paused.
  The run exposed a separate **Open run to cancel** action. A UTC edit changed all three previews; a
  republished dependency opened as **Needs review** with repair actions; Escape dismissed the modal.
  A 760×700 narrow-window artifact is at
  `.acorn/agent-dev/workflow-v2-phase17/screenshots/phase-17-narrow.png` (local, not committed).

The isolated session had no usable Linear/provider fixture, so baseline failure and source checkpoint
choices were demonstrated by the real temporary-SQLite/component tests rather than by a live-provider
window. The real terminal client built and reached the isolated Node, but the desktop-owned service
cannot issue the standalone process's documented `SIGUSR1` pairing code, so it stopped at pairing;
the shared terminal projection is covered by the 162-case TUI run. Those two live-host cases remain
acceptance evidence for slice 20 rather than being claimed as completed here.

## Verify before building

Read running UX and scheduler target rules. Do not display cursor/epoch/hash fields or force scheduling settings into manual workflow creation.
