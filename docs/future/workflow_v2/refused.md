# Refused alternatives

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [decisions and simplicity check](./context.md).

| Excluded | Reason and revisit condition |
| --- | --- |
| Universal ticket/work-item schema | It loses provider meaning. Keep source records and optional display hints. Revisit only for a demonstrated domain operation requiring normalization. |
| Provider-specific workflow or dashboard editor | It defeats the shared plugin contract. Extend declarative metadata with a proving consumer instead. |
| Cross-source query unions and joins | Dashboard composition covers the requested mixed display. Revisit only with a concrete workflow needing combined query semantics. |
| Multiple connections in one query | It complicates scope, options, and partial success. Use separate explicit queries initially. |
| Generic host query fallback | It can turn unsupported filtering into incomplete or expensive work. Sources must declare supported semantics. |
| Full raw provider payload as a mandatory record | Large or sensitive details belong in scoped detail reads. Preserve typed nested projections without promising every upstream field. |
| Schema inferred only from samples | Empty and varying results cannot prove field contracts or query support. Combine declared/dynamic schema with explicitly observed optional fields. |
| General expression language | Typed bindings and bounded predicates cover the examples. No embedded JavaScript, arbitrary transformations, or evaluation engine. |
| A second child execution mechanism | Structured AI output followed by For each replaces direct fan-out and its dedicated join. |
| Arbitrary recursive workflow references | Bounded nesting over an acyclic definition graph is sufficient. Dynamic recursion complicates preflight and budgets. |
| Simulated execution or a special single-record test run | Preview checks data/bindings only. Users run published workflows through the ordinary flow. |
| Executing unpublished drafts | Explicit publication keeps the runnable version understandable. |
| Automatic query preview on typing | Refresh preview is explicit; display edits redraw from existing data. |
| AI applies/publishes changes silently | Proposals require review; application is one undoable draft edit. Publication and activation remain separate. |
| Automatic record samples sent to AI | Metadata is automatic; sample contents require opt-in. |
| Automatic failed-item retries | Retain the failed attempt and require explicit retry. Infrastructure reconciliation is separate from re-executing work. |
| Queuing every observed record version | Process the latest relevant changes at the next scheduled check. This is not an event-log product. |
| Timestamp checkpoints claimed as reliable for every source | Incremental reads require a declared continuation contract. Rolling windows remain available with their limits. |
| Overlapping runs of the same schedule | Skip with a visible active-run link. Revisit only if real throughput requires per-record concurrency beyond this policy. |
| Scheduled backlog draining and first-N checkpoint advancement | Do not move a boundary past work that was not durably selected. A persistent backlog is a separate programme. |
| Automatic or batch task archiving | Retain ordinary task/worktree history and existing individual archive actions. |
| General publication framework, CRDT, data warehouse, or second job engine | Feature-owned state, optimistic conflict review, and existing Node infrastructure cover this programme. |
| Standalone saved-query repository files | Export queries inline into workflow files. A workspace library is enough for initial reuse. |
| New generic provider mutation/write-back contract | Data acquisition is shared; existing contributed workflow actions remain available. Dashboard write-back remains separate work. |
| Indefinite legacy collection/fan-out compatibility | Complete the transition and remove adapters. Development data may be reset within the explicit boundary. |
| SQL-backed panels as a prerequisite | Prove dynamic discovery with an installed fixture. The database plugin's taskless connection work remains separate. |

## Verify before building

Read these exclusions before adding an abstraction or expanding a slice. The user-approved choices
in [context](./context.md) take precedence over older future-work refusals for overlapping behavior.
