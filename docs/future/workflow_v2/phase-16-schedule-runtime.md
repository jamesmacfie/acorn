# Slice 16: Approved occurrences and incremental checks

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./scheduling.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 09, 10. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A schedule starts one recoverable root run with typed inputs and correct per-record history after Node restart.

## Work

1. Register the workflow schedule target and persist approved graph/input/limit/timezone bindings.
2. Add durable occurrences with intended task/run identities and generation/due-time uniqueness.
3. Enforce tree-wide overlap, catch-up once, dispatch-time approval checks, pause/delete/Run now behavior, and authority revocation.
4. Add explicit timezone calendar behavior while preserving unrelated scheduler targets.
5. Connect baseline and incremental source continuation to the processing ledger; distinguish transient source retries from retrying failed child work.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test manual/timer races, crash recovery, zero-match occurrence, changed dependency approval, active gate overlap, pause vs cancel, Run now history, baseline failure, expired tokens, incomplete query, and daylight-saving boundaries using a controlled clock.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read scheduler execution duration assumptions and internal workflow start. The overlap guard must remain active after root dispatch returns, until its descendants settle.
