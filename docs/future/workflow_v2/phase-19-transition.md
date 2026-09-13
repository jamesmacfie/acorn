# Slice 19: Complete migration and remove superseded paths

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./verification.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 03–18. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

Every dashboard/data consumer uses the shared source contract, and legacy batch execution is gone.

## Work

1. Inventory all compiled/loaded collections, toolkit declarations, client synthesis, caches, core tasks, agent sessions, panel regions, and measure sampling.
2. Move remaining sources to Node-owned declarations and migrate pure projection/sampling consumers. Preserve unknown optional status honestly.
3. Remove legacy collection schemas/parameters, client-only option/fetch authority, old cold-schema behavior, direct fan-out/join, and temporary adapters.
4. Implement the exact targeted development-state reset with a recoverable export and quiescent-writer preflight. Do not run it against unrelated user state.
5. Update owned workflow fixtures/files and actionable old-format diagnostics. Update owning documentation and SDK examples, then remove transition gates.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Run reference/import scans, full lint, relevant suites, database checks, and architecture tests. Test the reset on a copied fixture root containing unrelated tasks, credentials, notes, sessions, and files and verify those survive.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Inventory exact persisted keys/tables before reset. Preserve source files and unrelated worktree changes. Check the separate dashboard backlog notices and remove obsolete implementation guidance when superseded behavior ships.
