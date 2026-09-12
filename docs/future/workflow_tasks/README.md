# Workflow tasks

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Implement this programme before [scheduled workflows](../scheduled_workflows/README.md).
The outcome is a saved workflow dispatching saved child workflows into their own tasks, with
validated inputs, durable lifecycle, bounded execution, and AI-assisted authoring.

## Read first

- [Background and code reference](./background.md)
- [Execution contract](./reference.md)
- [Scope and refused alternatives](./refused.md)

## Phases

Execute in order. Every phase is not started. Keep runtime dispatch unavailable to users until
the full programme passes; merging storage preparation does not authorize partial release.

| Phase | Deliverable | Status |
| --- | --- | --- |
| [01](./phase-01-contracts-and-resolution.md) | Define child workflow contracts and resolution | Not started |
| [02](./phase-02-durable-dispatch.md) | Persist dispatch intent and run lineage | Not started |
| [03](./phase-03-child-lifecycle.md) | Execute and reconcile child workflow runs | Not started |
| [04](./phase-04-tree-safety.md) | Enforce tree-wide authority and budgets | Not started |
| [05](./phase-05-structured-map.md) | Map structured items into child tasks | Not started |
| [06](./phase-06-authoring-and-ai.md) | Teach the editor and AI authoring the dispatch model | Not started |
| [07](./phase-07-navigation-and-acceptance.md) | Expose child runs and complete the handoff | Not started |

## Completion and handoff

The fixture ticket flow must create one task and independent child run per selected item, pass
the ticket string as a declared input, survive restart without duplicates, and expose child results.
Generated workflows must pass the same path as manually authored ones.

Run `pnpm lint`, `pnpm test`, `pnpm db:check`, and `pnpm --filter @acorn/arch-tests test`.
Record commands, results, migrations, and manual UI checks in the phase documents. Do not describe
unimplemented behavior in the owning product docs. On completion, move shipped contracts there
and reduce these plans to pointers according to the future-doc convention.

## Verify before building

Read the repository guide and owning docs. Check the baseline against the working tree, preserve
unrelated edits, and confirm each preceding phase is complete before starting the next.
