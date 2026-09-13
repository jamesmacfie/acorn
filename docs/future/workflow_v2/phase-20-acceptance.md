# Slice 20: Release acceptance and documentation handoff

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./verification.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 19. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

All examples, installed-plugin parity, recovery behavior, and real UI journeys have recorded evidence.

## Work

1. Execute the complete verification matrix, including manual and AI versions of the three example workflows and dashboard reuse.
2. Run installed-plugin conformance without host special cases and verify both compiled and loaded registration paths.
3. Exercise the configured 500-descendant load, nested cancellation/restart, occurrence recovery, and publication conflicts.
4. Complete real Tauri-window and terminal UX checks, including keyboard navigation, narrow layouts, stale previews, and recovery.
5. Record commands/outcomes/artifacts, move implemented behavior to owning docs, update programme status, and leave any unmet criterion explicitly incomplete.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Run pnpm lint, pnpm test, pnpm db:check, and pnpm --filter @acorn/arch-tests test. Use the isolated real-window workflow from verification. No component-only substitute for visual acceptance and no suite subset labeled as the full suite.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Re-read the agreed exclusions and all preceding evidence. A passed build is not proof of publication, checkpoint, or plugin-contract correctness.
