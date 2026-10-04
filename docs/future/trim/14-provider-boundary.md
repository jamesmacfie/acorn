# Phase 14: resolve the remaining provider coupling decision

Date: 2026-10-04. Status: TODO. Risk: low for this decision task; a migration would be high risk.
Prerequisite: accepted [phase 13](./13-agent-composition.md). Next: [phase 15](./15-acceptance.md).
Planning revision: `2ae55abb5`; no schema migration is authorized by this assignment.

## Task and context

Decide whether the remaining GitHub-specific core/protocol model warrants a separate migration now.
This was the audit's least immediate recommendation: it is architectural debt with a substantial
compatibility cost, not a demonstrated need to rewrite storage during a cleanup programme.
Produce a concrete consumer map and decision a developer can act on later.

Core projects hold GitHub repository identity; tasks and task pull relations retain PR identity and
managed-agent provenance. Public project/task transport exposes GitHub fields, and client rail/task
features consume them. Meanwhile core already has generic connections, external item/task links, and
workspace external-project mappings. Do not invent a second generic model without comparing these.

## Starting points

- `packages/node-core/src/server/db/schema.ts`: project GitHub columns, task pull identity, task pulls.
- `packages/protocol/src/transport/api/projects.ts`: project/task GitHub fields and creation payloads.
- `packages/node-core/src/server/core/projectRefs.ts`, `server/core/tasks.ts`, `server/projects.ts`,
  provider stores/routes and their current public exports.
- `packages/client-core/src/features/tabs/TabRail.tsx` or the phase 07 owner, task detail/context,
  GitHub plugin, Changes plugin, workflow policies, and managed-agent PR linking.
- [Core DB](../../data-layer/core-database.md), [integrations](../../integrations.md),
  [project sources](../../integrations/project-sources.md), [GitHub](../../github-integration.md),
  [migrations](../../data-layer/migrations.md), and [compiled tier](../compiled-tier.md).

## Implementation steps

1. Inventory every writer/reader of repository identity, primary pull number, task pull relations,
   and GitHub-shaped transport. Include server adapters, public routes, caches, rendered markers,
   import/export/backup, workflow policy, and provenance. Record actual source paths and contracts.
2. Trace ownership: canonical durable relation vs disposable provider mirror; connection identity vs
   repo identity; workspace/project/task scope; read projection vs mutation. Identify invariants such
   as composite uniqueness, disconnect/delete cascade, multiple pulls, offline reads, and provenance.
3. Compare existing generic mappings and external-item/task-link models against those invariants.
   A normalized shared read model may legitimately belong to core. Moving it into the GitHub DB
   cannot require core to join that database or lose durable task provenance when a mirror is pruned.
4. Find a concrete present consumer that is blocked or repeatedly complicated by the GitHub shape.
   Another hypothetical provider alone is insufficient. Record the actual change and maintenance
   burden, or explicitly state that no current blocker was found.
5. Write the decision in this file's delivery section and `evidence.md`:
   - **Retain:** identify legitimate shared-core ownership, remaining leaks, and a precise trigger
     for revisiting them. State which references are historical conveniences and which are required.
   - **Propose migration:** give exact existing/target ownership, additive wire projection, mappings,
     new/old client behavior, backfill/cutover sequence, rollback, and deletion conditions. Identify
     the first real consumer and the existing generic owner to extend instead of creating a parallel one.
6. For a proposed migration, make a separate future implementation assignment with its own scope,
   compatibility fixtures, commands, and acceptance. Mark any new source path as new. Index the
   assignment in both future indexes. Do not execute it during this phase or make phase 15 depend on
   unapproved schema work. This programme completes with the decision and actionable follow-up.
7. Correct owning documentation only if current behavior/ownership was described inaccurately.
   Describe prospective contracts in future docs. No public API removal, schema edits, plugin-tier
   changes, new abstraction framework, or data migration ships in this task.

## Verification

Cross-check the inventory against current schema, routes, exports, and consumers. For a migration
proposal, enumerate actual fixtures needed: populated legacy DB, two connections/repos with matching
pull numbers, multiple task links/provenance, disconnected provider, offline reads, old/new wire
clients, interrupted migration, backup/restore, and rollback. Document expected observable results.

For this documentation-only phase run:

```sh
pnpm --filter @acorn/arch-tests test
```

No unchanged production suite needs to be rerun just to support a design decision. Any future
migration requires supported-runtime lint, affected packages/consumers, `pnpm db:check`, full tests,
and real-host acceptance in its own assignment.

## Acceptance and handoff

- Complete writer/reader and entity-invariant maps distinguish durable relations from provider cache.
- A dated retain/propose decision cites a concrete need, cost, compatibility, and existing owner.
- If migration is justified, its separate task can be picked up without this conversation. No code
  or schema has changed under this phase. Retention does not claim the coupling was removed.
- Update task/table/evidence and hand off final scope/dispositions to phase 15. Reversal is a revised
  decision record, not a destructive data operation.

## Verify before building

Inspect live core/protocol entities, generic mappings, and consumers after the prior refactors. Stop
short of implementation if compatibility/data ownership is uncertain; complete the documented decision.
