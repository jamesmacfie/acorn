# Slice 06: Typed workflow inputs, outputs, and stable steps

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./workflow-contract.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 01. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A workflow passes a whole record, a number, and a boolean to another structured consumer without string coercion.

## Work

1. Version definitions and add stable step IDs, typed inputs/defaults, named outputs, and typed bindings.
2. Update graph edges, predecessor checks, branch references, rename/reorder behavior, TOML codec, public contracts, and API validation together.
3. Validate structured outputs on the Node and expose typed results to step handlers. Keep prompt formatting at the text boundary.
4. Implement explicit missing/fallback/optional rules and supported conversions.
5. Update generation catalog metadata and source-item start prefill types. Keep old-format errors actionable while v2 remains gated.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Round-trip nested values through TOML and route DTOs. Test missing vs null, whole-record bindings, named child outputs, numeric keys, incompatible types, sibling references, safe paths, and rename/reorder preserving stable identities.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read workflow bindings, extension contracts, file expansion, step descriptors, and start routes. Preserve unrelated step behavior and compile all public consumers after changing shared types.
