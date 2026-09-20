# Slice 13: Outline-led workflow authoring

Date: 2026-09-20. Status: implementation complete; connected-provider verification pending.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-authoring.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 07, 10, 11, 12. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A user manually authors and publishes the full Linear triage/conditional-analysis flow without writing pointers or schema JSON.

## Work

1. Replace Nodes/Graph/JSON as the main mental model with the outline, selected-step configuration, and contextual preview; retain secondary graph/code views.
2. Add readable step summaries, branch labels, dependency chips, and guided Find records → For each setup.
3. Create child workflows in context with prefilled typed record inputs and return navigation that preserves the parent.
4. Add a structured-output field editor, autosave/publication states, dependency review, file conflict flow, and one undo stack for draft edits.
5. Integrate published-only run entry and visibly explain unmet setup. Keep advanced limits/title/key controls collapsed until needed.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Verify all three manual examples, adding/removing/reordering steps, referenced-step deletion, draft recovery, child-target changes, publish blockers linking to controls, file editing, keyboard operation, and narrow/terminal layouts.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Implemented the outline as the default authoring view. Step rows show behavior, dependencies, and
branch labels. The selected-step inspector has a contextual preview, and Graph and Code continue to
read and edit the same definition and stable IDs. Reordering and the guided Find records to For each
action use the draft's single undo history.

`NodeInspector.tsx` remains the selection and mutation orchestrator. Definition settings, workflow
inputs, and described step fields live in `DefinitionInspector.tsx`, `InputsInspector.tsx`, and
`StepConfigurationFields.tsx`. This split keeps query, binding, condition, and schema dispatch
together while retaining one draft and action contract. The orchestrator is 289 lines; the extracted
components are 83, 68, and 101 lines.

The inspector reuses the shared query editor and typed field picker for mapped arrays, child inputs,
and direct conditions. Structured agent output uses a recursive field editor. Title templates,
ordinary-array identity keys, and execution limits remain collapsed. Creating a child from For each
prefills a required typed `record` input and a Current record binding. The parent link returns to the
same stable step. Unpublished child drafts appear as draft targets in the editor, but generation and
Run use published definitions only.

Automated evidence:

- `pnpm --filter @acorn/plugin-workflows test` passed 49 files and 439 tests. The final focused run
  passed 22 tests across `outlineModel.test.ts`, `workflowCatalog.test.ts`, and
  `NodeInspector.test.tsx`.
- The focused editor run passed seven files and 65 tests. It covers the shared picker, structured
  schema fields, conditions, guided For each setup, child prefill, recovery, reorder, delete
  references, and undo.
- `pnpm --filter @acorn/client-core exec vitest run
  src/features/dataSources/fieldPickerModel.test.ts
  src/features/dataSources/TypedBindingPicker.test.tsx` passed two files and three tests.
- `pnpm --filter @acorn/protocol test` passed 25 files and 173 tests.
- `pnpm --filter @acorn/plugin-api test` passed three files and 12 tests.
- `pnpm --filter @acorn/tui exec vitest run src/kit/kit.test.tsx src/kit/field.test.ts
  src/layouts/layouts.test.tsx src/keys/keys.test.tsx --reporter dot` passed 165 tests and skipped
  two controlled cases. These tests cover the closed-kit nodes, region order, arrows, Enter, Escape,
  and narrow terminal layout.
- `pnpm lint` completed all 33 type-check tasks. Oxlint reported only the repository's existing
  warning set.
- `pnpm --filter @acorn/arch-tests test` passed four files and 63 tests.
- The maintainability follow-up reran seven focused editor files with 68 passing tests. The workflow
  TypeScript check and targeted Oxlint check passed.

Real-window evidence used the isolated `workflow-v2-phase13` session. The desktop flow created a
database workflow, added Find records, used **Add For each for these records**, and showed the
preselected `find-records → records` binding. It created a child in context, opened the child with a
typed required `record` input, returned to the selected parent step, and retained the
`Current record → Current record` binding. The parent showed the child as `(draft)`. An unpublished
parent disabled **Run published…** and linked its reason to **Review publication**.

Repository-file verification opened a committed fixture, autosaved a visual name edit, and left the
published Run action available for the unchanged published file. A non-overlapping external prompt
edit merged during review. A same-field name edit produced **File conflict: /name** with **Keep your
change** and **Keep external change** actions. The fixture and session were removed after the check.

Inspected screenshots:

- `.acorn/agent-dev/workflow-v2-phase13/screenshots/phase13-child-draft.png`
- `.acorn/agent-dev/workflow-v2-phase13/screenshots/phase13-file-conflict.png`

Controlled tests cover readable GitHub pull request, Linear issue, and Rollbar occurrence authoring
summaries without exposing `/records`. This isolated session has no connected provider accounts, and
the bundled Linear node entry reports its pre-existing `node:module` isolation error. The three live
provider journeys therefore remain for connected-account acceptance. A direct terminal attach also
could not reuse the desktop automation fixture's encrypted local-device token; the closed-kit and
terminal keyboard suites pass, but a live terminal editor capture remains pending.

## Verify before building

Read the existing editor/draft/graph code and authoring UX. Do not introduce a second graph representation or expose hundreds of runtime children in the authoring outline.
