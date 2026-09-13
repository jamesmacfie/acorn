# Slice 01: Typed values and structural schemas

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./data-contract.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: None. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

Parse and validate the same nested value in a source record, a workflow input, and a field picker.

## Work

1. Add the versioned value, bounded structural schema, field metadata, binding-address, and predicate DTOs to the protocol. Export them through the appropriate facade/toolkit surfaces.
2. Implement pure schema parsing and value validation for the supported subset. Reject unsupported constructs, non-finite numbers, unsafe paths, excess depth, and oversized descriptions.
3. Implement own-property pointer traversal, missing/null distinction, canonical projection encoding, and primitive comparison semantics in small feature-neutral modules.
4. Keep display hints separate from validation and keep query capability declarations separate from field type.
5. Add an installed-plugin fixture schema with nested objects, arrays, optional and observed fields, and dynamic choice metadata. Do not migrate execution consumers in this slice.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Protocol and facade tests cover valid nested records, unsafe pointers, nullable vs missing values, unsupported schema constructs, canonical object ordering, array ordering, and all configured bounds. Confirm the contracts load in both Node and client builds.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read the existing collection and workflow types and toolkit export rules. Reuse safe-pointer behavior, but remove the string-only assumption from the proposed v2 types.
