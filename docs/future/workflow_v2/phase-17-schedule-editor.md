# Slice 17: Scheduling, activation, and change review

Date: 2026-09-13. Status: not started.

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

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read running UX and scheduler target rules. Do not display cursor/epoch/hash fields or force scheduling settings into manual workflow creation.
