# Slice 06: Typed workflow inputs, outputs, and stable steps

Date: 2026-09-14. Status: implemented; legacy cutover remains assigned to phase 19.

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

Implemented shared typed bindings and inputs, named workflow outputs, stable step IDs in the existing
derived graph, TOML typed JSON fields, Node structural result validation, typed start/prefill DTOs,
public extension exports, catalog metadata, and basic editor controls. Run rows retain their human
names; a frozen row index resolves its definition ID without changing persisted historical rows.

Verification on 2026-09-14:

- `rtk pnpm lint`: passed, 33 package tasks. Existing oxlint warnings and sandbox cache-write warnings
  remain nonfatal.
- `rtk pnpm --filter @acorn/plugin-workflows test`: passed, 353 tests in 35 files.
- `rtk pnpm --filter @acorn/protocol test`: passed, 171 tests in 24 files.
- `rtk pnpm --filter @acorn/plugin-api test`: passed, 12 tests in 3 files.
- `rtk pnpm --filter @acorn/arch-tests test`: passed, 63 tests in 4 files.
- Final focused editor/value checks: 33 tests passed. The source-item promotion modal's 6 tests and
  `@acorn/client-core lint` passed after its typed-input pre-admission check.
- New regression cases cover nested-null TOML, typed defaults and route DTOs, missing/null/fallback,
  whole records/numbers/booleans, explicit conversions, own-property safe pointers, sibling exclusion,
  numeric versus textual item keys, and rename/reorder preserving stable references. A real temporary
  SQLite parent/child run verifies typed inputs and named child outputs. A mismatched agent output
  fails on the Node before its successor runs.
- Real Tauri session `workflow-values-qa`: created a disposable definition, applied the typed fixture
  through JSON, confirmed human labels and `Valid · 2 nodes · 1 roots`, inspected object/number/boolean
  default controls, saved it, and opened its typed start dialog. Screenshot inspected at
  `.acorn/agent-dev/workflow-values-qa/screenshots/typed-inputs.png`.
  Both isolated sessions were stopped after verification.

The first sandboxed UI launch built successfully but hit `EPERM` opening tsx IPC. The approved
unsandboxed isolated session worked after selecting the seeded Default workspace. No provider or
agent execution was used for this UI check.

Transition removal targets: `shared/workflowLegacy.ts`, the legacy name fallback in
`shared/workflowIdentity.ts`, optional v2 identity/schema fields, unversioned validation/admission,
legacy codec/generation examples, and legacy-only assertions. Version 2 refuses old binding shapes;
unknown file versions return an explicit format-version upgrade diagnostic. No development data was
reset in this phase. The richer field picker and outline authoring remain phases 12–13.

## Verify before building

Read workflow bindings, extension contracts, file expansion, step descriptors, and start routes. Preserve unrelated step behavior and compile all public consumers after changing shared types.
