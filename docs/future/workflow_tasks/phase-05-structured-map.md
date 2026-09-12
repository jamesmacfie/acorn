# Map structured items into child tasks

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 4. Scope: Typed binding evaluation, map handler, and dispatch roster.

Read [background](./background.md), [execution contract](./reference.md), and [scope](./refused.md) before implementing. This phase is not independently releasable before the programme's final gate.

## Implementation

1. Implement a pure binding evaluator in a feature-owned workflow server module. Read stored structured output directly, not rendered prompt text. Support the closed JSON Pointer vocabulary from the reference.
2. Validate the entire array, unique item keys, input values, and capacity before creating child tasks. Persist the ordered item snapshot and resolved input roster before admission.
3. Dispatch each item through phase 2's operation and phase 3's lifecycle. Use stable item keys within the parent step, never just array positions.
4. Return bounded ordered summaries and make downstream steps able to consume the structured result. Empty arrays succeed; oversized arrays safety-rail without truncation.
5. Use deterministic safe task titles and core-generated unique branches. Keep arbitrary external-link creation and Linear-specific querying outside this phase.

## Tests and acceptance

Cover zero, one, 12, and 13 items; duplicate keys; missing/string/object inputs; malformed pointers; changed source output after restart; concurrent recovery; partial child failure; and cancellation halfway through admission. No child starts when upfront validation fails.

Add colocated `.test.ts` or `.test.tsx` tests beside the changed module, following its neighboring tests. Run `pnpm --filter @acorn/plugin-workflows test` and `pnpm lint`; both must exit zero. For core changes also run `pnpm --filter @acorn/node-core test`. For migrations run `pnpm db:check`. Phase 7 additionally requires `pnpm test` and `pnpm --filter @acorn/arch-tests test`.

## Stop conditions

Do not use an LLM to interpret bindings or filter the collection. If the source lacks structured output, return an actionable error instead of parsing prose heuristically.

## Verify before building

Compare the scoped implementation with `git diff 8cb7ce45..HEAD -- plugins/workflows packages/node-core`. Re-read changed contracts and tests; amend this phase if assumptions have drifted. Keep core/plugin imports, task authentication, and unrelated work untouched. Record test evidence and update the [phase status](./README.md) on completion.
