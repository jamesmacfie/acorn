# Slice 12: Shared source/query editor and field picker

Date: 2026-09-20. Status: complete.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-authoring.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 03, 04, 05. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A user builds and previews a query and selects a nested field with the same controls used by both features.

## Work

1. Implement host-kit source selection, visible connection scope, dependent parameters, searchable options, all/any groups, and typed operands.
2. Add explicit Refresh preview, prior-result retention, query-digest staleness, and nested record inspection.
3. Implement the shared typed binding picker with origins, compatibility ordering, observed/optional labels, explicit conversions, and fallbacks.
4. Add saved-query selection and explicit shared-edit/local-customization choices.
5. Cover cold/empty/loading/error/incomplete/schema-change states, keyboard focus restoration, and narrow/terminal region behavior.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Component tests cover stale response races, project/state invalidation, no automatic record fetch on typing, missing examples, incompatible fields, and safe rendering. Demonstrate an unfamiliar installed source in the real Tauri window and terminal.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Implementation:

- Client core owns one descriptor-driven `SourceQueryEditor`: source/saved-query selection, visible
  connection scope, dependent parameters, searchable dynamic options, supported all/any groups,
  typed operands, and explicit preview. Provider plugins contribute no forms.
- The preview controller retains prior rows, tags them by query digest, ignores obsolete generations,
  and keeps failed refreshes distinct from empty and incomplete results. Nested and observed record
  fields render as bounded text.
- `TypedBindingPicker` accepts admitted origins and a destination schema. It groups workflow inputs,
  current record, and predecessor results; ranks exact, explicit-conversion, and incompatible paths;
  labels missing examples and optional/observed paths; and supports typed fallback values.
- Saved queries use the phase-05 client and recovery store. Shared edits autosave with revision checks;
  conflicts retain local and remote versions. Customization creates an inline consumer copy.
- Workflows consumes the shared query editor for `find-records` and the shared binding picker for
  record bindings. The dashboard seam is the same exported component and protocol value, without
  implementing phase 14.
- One feature-owned kit seam selects DOM or terminal primitives. The controller, editor tree, query
  rules, and binding compatibility stay single-source and the connected UI facade remains lazy.

Automated checks on September 20, 2026:

- `rtk pnpm --filter @acorn/client-core test src/features/dataSources`: five files, nine tests passed.
- `rtk pnpm --filter @acorn/plugin-workflows test src/client/editor/NodeInspector.test.tsx`: one file,
  12 tests passed.
- `rtk pnpm --filter @acorn/protocol test src/dataSchemas.test.ts src/dataBindings.test.ts`: two files,
  seven tests passed.
- `rtk proxy env UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test src/surface.test.ts`: one test
  passed and the additive facade snapshot was updated.
- `rtk pnpm --filter @acorn/node-core test src/server/dataSources/runtime.test.ts`: one file,
  18 tests passed.
- `rtk pnpm --filter @acorn/plugin-api test src/surface.test.ts src/entrypoints.test.ts`: two files,
  11 tests passed.
- `rtk pnpm --filter @acorn/arch-tests test boundaries.test.ts`: one file, 52 tests passed.
- `rtk pnpm --filter @acorn/tui test src/kit/kit.test.tsx`: one file, 115 tests passed and two skipped.
- Focused TypeScript lint passed for protocol, node-core, client-core, plugin-api, workflows, TUI,
  and architecture packages. `rtk pnpm lint` passed all 33 workspace lint tasks.

Real-host evidence on September 20, 2026:

- Installed the repository's `typed-source` conformance fixture into the isolated
  `workflow-v2-phase12` data root, then launched `pnpm dev:agent -- --session
  workflow-v2-phase12 --reuse`.
- In the real Tauri workflow editor, **Find records** listed the unfamiliar **Nested records** source,
  loaded its searchable Project options, and queried records only after **Refresh preview**. The
  expanded row showed nested, missing, and observed fields. Changing Project to Closed retained the
  row and displayed **Preview is out of date**.
- Screenshots: `.acorn/agent-dev/workflow-v2-phase12/screenshots/source-query-editor.png`,
  `nested-preview.png`, and `stale-preview.png`.
- In the actual `acorn` terminal client, the same saved workflow opened in cells. Selecting
  `find-records` rendered **Nested records**, Project **Closed**, **Add condition**, and the explicit
  preview control. The first terminal pass exposed a DOM-kit leak (`Unknown component type: <div>`);
  the feature-owned host-kit seam fixed it, and the repeated pass rendered without a pane failure.
  The TUI and its standalone Node were stopped after inspection.

The standalone `vite build` for the terminal host succeeds. Its broader `build` script currently
reports the accumulated branch's eager startup closure at 1,147,549 bytes against a 1,130,000-byte
budget. The phase-12 editor remains in the lazy workflow chunk, and this budget warning does not
block the demonstrated slice outcome; it remains visible for the final programme audit.

No phase-12 acceptance gap remains.

## Verify before building

Read the closed kit support table and existing picker/field components. Expand a shared kit component only when required for both consumers; do not build provider-owned form components.
