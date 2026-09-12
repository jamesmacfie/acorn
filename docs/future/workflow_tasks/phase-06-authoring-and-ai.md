# Teach the editor and AI authoring the dispatch model

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 5. Scope: Step catalog, editor, generator, edit protection, and examples.

Read [background](./background.md), [execution contract](./reference.md), and [scope](./refused.md) before implementing. This phase is not independently releasable before the programme's final gate.

## Implementation

1. Extend `plugins/workflows/src/shared/stepFields.ts` and `plugins/workflows/src/client/editor/` with a scoped child-workflow picker, declared-input bindings, map source, item key, and validation messages. Use closed-kit components and preserve invalid drafts.
2. Supply AI generation with a bounded catalog of available workflow references, declared input signatures, and output schemas when available. Include both runtime kinds and worked structured-output examples. Exclude secrets and runtime input values.
3. Extend `plugins/workflows/src/server/generateWorkflow.ts`, `generateWorkflowRequest.ts`, and `groundWorkflow.ts` together. Ground references against the supplied catalog; reject invented IDs, unsupported bindings, and invalid graph references.
4. Extend `plugins/workflows/src/server/editWorkflow.ts` protected-field handling. Preserve configured execution targets and authority settings for surviving same-name, same-kind steps. Renaming, deletion, or kind changes must not transfer authority to a different step.
5. Let generation propose only catalog-backed targets in an unapproved draft. Changing a configured target requires explicit user review. Generation and repair never start a child, approve trust, or arm a schedule.
6. Add examples to generation prompts and authoring docs for single-child execution and collection mapping. Keep overwrite, edit, one repair attempt, JSON editing, TOML import/export, and save-to-repo behavior consistent.

## Tests and acceptance

Test generate → ground → validate → save → reopen → run with fixture children. Test AI edits preserving protected targets, hallucinated refs, absent required bindings, empty catalogs, renamed steps, and repairs that retain valid graph content. Exercise both supported AI backends through mocked generation contracts.

Add colocated `.test.ts` or `.test.tsx` tests beside the changed module, following its neighboring tests. Run `pnpm --filter @acorn/plugin-workflows test` and `pnpm lint`; both must exit zero. For core changes also run `pnpm --filter @acorn/node-core test`. For migrations run `pnpm db:check`. Phase 7 additionally requires `pnpm test` and `pnpm --filter @acorn/arch-tests test`.

## Stop conditions

Do not relax the forbidden authority keys to make generated output pass. If the generic field catalog cannot express the picker, extend its typed descriptor vocabulary rather than adding DOM escape hatches.

## Verify before building

Compare the scoped implementation with `git diff 8cb7ce45..HEAD -- plugins/workflows packages/node-core`. Re-read changed contracts and tests; amend this phase if assumptions have drifted. Keep core/plugin imports, task authentication, and unrelated work untouched. Record test evidence and update the [phase status](./README.md) on completion.
