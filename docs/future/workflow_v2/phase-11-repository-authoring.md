# Slice 11: Visual repository editing and portable export

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./publication.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 10. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A visual draft publishes to a workflow file, detects external edits, and exports saved dependencies without hidden query IDs.

## Work

1. Persist file drafts by project/confined relative path with base file hashes and recoverable edit state.
2. Integrate file changes with semantic conflict review and atomic per-file writes. Leave working-tree changes uncommitted.
3. Export published query content inline and database-owned child workflows as reviewed sibling files, rewriting references.
4. Convert Node-local connection selections to constrained named inputs; list provider project/state dependencies that need destination validation.
5. Journal multi-file publication progress, detect conflicting external writes, and retain partial-operation recovery. Preserve repository trust during run admission.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test TOML nested-value round-trip, file changed/deleted externally, symlink escape refusal, existing-path conflict, interrupted multi-file export, child reference rewriting, destination connection setup, and no database query IDs in exported definitions.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read file confinement, codec, graph resolution, and trust code. Do not commit files, change branches, delete workspace originals, or silently overwrite known external changes.
