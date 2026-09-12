# Define child workflow contracts and resolution

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: None. Scope: Contracts, validation, file parsing, and definition resolution.

Read [background](./background.md), [execution contract](./reference.md), and [scope](./refused.md) before implementing. This phase is not independently releasable before the programme's final gate.

## Implementation

1. Add typed runtime dispatch fields in `plugins/workflows/src/shared/workflowContracts.ts` and validation in `plugins/workflows/src/server/workflowValidation.ts`. Implement the tagged binding types and error locations in the reference.
2. Extract reusable scoped resolution from `plugins/workflows/src/node/index.ts` into a feature-owned server module. Preserve file trust and database workspace/project checks.
3. Resolve and freeze the referenced graph, including child defaults and provenance. Reject cycles and depth overflow. Keep invalid draft saves separate from executable preflight.
4. Extend `plugins/workflows/src/server/workflowFiles.ts` and `workflowToml.ts` for the distinct runtime reference. Preserve static expansion. Keep runtime kinds unavailable for start until the lifecycle and safety phases pass.

## Tests and acceptance

Round-trip both kinds through JSON and TOML; retain static composition fixtures. Reject missing child definitions, wrong project, path traversal, cycles, undeclared inputs, missing required inputs, and non-predecessor mappings. A saved draft may fail preflight without being destroyed.

Add colocated `.test.ts` or `.test.tsx` tests beside the changed module, following its neighboring tests. Run `pnpm --filter @acorn/plugin-workflows test` and `pnpm lint`; both must exit zero. For core changes also run `pnpm --filter @acorn/node-core test`. For migrations run `pnpm db:check`. Phase 7 additionally requires `pnpm test` and `pnpm --filter @acorn/arch-tests test`.

## Stop conditions

Do not resolve a child from whichever task directory happens to execute next. If file provenance cannot survive resolution, stop and repair the resolver contract first.

## Verify before building

Compare the scoped implementation with `git diff 8cb7ce45..HEAD -- plugins/workflows packages/node-core`. Re-read changed contracts and tests; amend this phase if assumptions have drifted. Keep core/plugin imports, task authentication, and unrelated work untouched. Record test evidence and update the [phase status](./README.md) on completion.
