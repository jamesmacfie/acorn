# Enforce tree-wide authority and budgets

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 3. Scope: Workflow admission, usage accounting, deadlines, and agent dispatch.

Read [background](./background.md), [execution contract](./reference.md), and [scope](./refused.md) before implementing. This phase is not independently releasable before the programme's final gate.

## Implementation

1. Centralize effective-grant calculation for root, dispatch step, and child. Revalidate source trust and revocation at dispatch. Pass only effective grants into managed and headless execution.
2. Enforce root depth zero, child depth at most one, and at most 12 descendant tasks across all steps. Persist reservations before concurrent admission.
3. Make root usage accounting include every descendant session exactly once, including failed attempts. Avoid summing child totals and the same leaf records twice.
4. Share the runner's agent concurrency limit across roots and children. Atomically reserve bounded turn admission; settle reservations after completion and recovery.
5. Propagate absolute ancestor deadlines through waits and gates. Restore deadline enforcement after restart. On a limit, stop admission and cancel active descendants with an explicit safety-rail reason.
6. Characterize provider usage granularity and document cost overshoot limits. Preserve spent usage on retries; do not advertise a hard dollar cap without pre-spend enforcement.

## Tests and acceptance

Race two dispatch steps against the final available task and turn allowance. Test narrowed child tools, revoked trust, cross-task token rejection, child attempts to broaden tools, budget exhaustion while gated, restart after deadline, and duplicate usage events.

Add colocated `.test.ts` or `.test.tsx` tests beside the changed module, following its neighboring tests. Run `pnpm --filter @acorn/plugin-workflows test` and `pnpm lint`; both must exit zero. For core changes also run `pnpm --filter @acorn/node-core test`. For migrations run `pnpm db:check`. Phase 7 additionally requires `pnpm test` and `pnpm --filter @acorn/arch-tests test`.

## Stop conditions

If the agent backend cannot enforce a grant or report usable accounting, fail closed for that configuration. Do not mint service-scoped credentials for the child.

## Verify before building

Compare the scoped implementation with `git diff 8cb7ce45..HEAD -- plugins/workflows packages/node-core`. Re-read changed contracts and tests; amend this phase if assumptions have drifted. Keep core/plugin imports, task authentication, and unrelated work untouched. Record test evidence and update the [phase status](./README.md) on completion.
