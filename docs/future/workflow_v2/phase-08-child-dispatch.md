# Slice 08: One dispatcher for nested child workflows

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./workflow-contract.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 06, 07. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A root dispatches a batch whose children conditionally start grandchildren, with one recovery path.

## Work

1. Extend frozen graph resolution and dispatcher lineage to the documented depth and root descendant limits.
2. Keep intended task/run IDs, payload fingerprints, reservation-before-effects, and transaction-checked admission.
3. Apply root budgets, deadlines, concurrency, cancellation, and usage accounting throughout the tree without parents holding agent slots.
4. Return ordered typed child outcomes and a distinct completed-with-failures status; independent children continue after an item failure.
5. Route AI-generated arrays through For each. Replace direct fan-out runtime and dedicated child-collection behavior, updating owned fixtures and retaining clear old-format diagnostics.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test two nesting levels, the maximum depth, cyclic references, 500-descendant ceiling, four active agent slots, gates with running siblings, mixed outcomes, and cancel/restart at each dispatch boundary. Verify no duplicate tasks or usage charges.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Re-read dispatcher/start-service/tree-safety and core intended-ID task creation. Do not implement a second queue or use array position as business identity.
