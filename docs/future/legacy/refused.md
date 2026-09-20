# Refused alternatives

Date: 2026-09-21. Status: review decisions.
Read [context](./context.md) and [findings](./findings.md).

| Alternative | Decision and reason |
| --- | --- |
| Collapse desktop, custody, and Node into one runtime | Refused. Independent Node execution and secret custody are product constraints. Remove feature leakage without weakening these boundaries. |
| Force all plugins into one execution tier | Refused for this programme. Native streams, bootstrap UI, and native agent drivers have concrete constraints; use one contribution model with appropriate carriers. |
| Delete every occurrence of “legacy”, “fallback”, or “migration” | Refused. Memory proposals still have a live producer, provider codecs need fixtures, and durable receipts protect present writes. |
| Keep old routes and adapters during the reset | Refused. The user accepted a breaking reset; bridge code would preserve the complexity the programme removes. |
| Delete the whole Acorn root | Refused. It can contain worktrees and this checkout. Reset an explicit artifact inventory with recovery. |
| Renumber every numeric version in the repository | Refused. Acorn contract/package versions reset; Drizzle, vendor protocols, and dependencies retain their required versions. |
| Use version 1 alone to identify the new contract | Refused. Historical version-1 artifacts can collide. Use one baseline identity at admission boundaries. |
| Remove plugin API range syntax | Refused. Ranges permit independently released compatible plugins; the host does not implement historical APIs to support them. |
| Rebuild the plugin RPC transport | Refused. The demonstrated risk is undeclared sync/async method classification. Test and declare that contract first. |
| Replace every registry singleton with a container | Refused. No concurrent multi-Node-in-one-process requirement was established. Preserve rollback/disposal and prove restart isolation. |
| Move all feature-looking data out of core | Refused. Tasks, provider credential custody, the item projection, queries, and shared dashboard computation have multiple real owners/consumers. |
| Remove workflow admissions, frozen revisions, receipts, or child dispatch records | Refused. They protect budgeting, approval, retry, and crash recovery, not old installs. |
| Keep full plugin row types in protocol because two plugins need them | Refused. Two plugins can share the producer's contract; that does not make the type core-owned. |
| Split all long files or rename every imperfect symbol | Refused. Separate proven responsibilities and misleading concepts; avoid a formatting-sized rewrite. |
| Introduce a general schema/code-generation or event-sourcing programme | Refused. The identified contract gaps can be fixed with DTO ownership, parity tests, and existing events/hooks. |
| Convert optional Findings failure into task failure | Refused. Findings observes task work. Required approval/application checks stay strict, while automatic capture degrades explicitly. |
| Expand into security, telemetry, performance, or release feature projects | Refused. Preserve their existing boundaries and test relevant regressions; this programme is maintainability and legacy removal. |

The simplicity pass retained the runtime topology, shared dashboard package, migration machinery,
capability map, and existing hook system. It removed a proposed blanket rewrite of registries and large
modules. The only new shared mechanisms are narrow session projections and the baseline identity,
each justified by named consumers or a concrete version collision.

## Verify before building

- Revisit a refusal only with a changed product requirement or new source evidence.
- Record a superseding decision here rather than silently widening a ticket.
