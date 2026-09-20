# Slice 01: Typed values and structural schemas

Date: 2026-09-13. Status: complete.

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

Implemented pure protocol modules `dataValues.ts`, `dataSchemas.ts`, and `dataBindings.ts`, exported
through the protocol map and both plugin facades. Published Node declarations have bidirectional
type checks. The installed-source fixture at
`apps/node/test/__fixtures__/typed-source/schema.json` passes the same parser through both facades.
It contains nested objects, arrays, optional values, observed metadata, and dynamic choices.

Verification on 2026-09-13:

- `rtk pnpm --filter @acorn/protocol test`: 23 files, 168 tests passed.
- `rtk pnpm --filter @acorn/plugin-api test`: three files, 12 tests passed.
- `rtk pnpm --filter acorn-plugin-types test`: two files, four tests passed.
- `rtk pnpm --filter @acorn/arch-tests test`: four files, 63 tests passed.
- `rtk pnpm lint`: 33 tasks passed. Existing oxlint warnings and shared-cache permission warnings
  remain nonfatal. An initial test type annotation failure was corrected before the passing run.

No UI or execution consumer changed, so real-window checks do not apply to this phase.
The [data-layer reference](../../data-layer.md#shared-typed-values) documents the implemented contract.

## Verify before building

Read the existing collection and workflow types and toolkit export rules. Reuse safe-pointer behavior, but remove the string-only assumption from the proposed v2 types.
