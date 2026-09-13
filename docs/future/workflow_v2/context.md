# Context and decisions

Date: 2026-09-13. Status: accepted design, implementation not started.
Survey baseline: `8e006e6b`.

## Goal

A user can discover integration data, select records, show them in a dashboard, and pass them into
workflows through the same typed contract. A third-party author supplies source behavior and
metadata, not a provider-specific workflow editor. AI generation uses the same discovered facts
as the visual controls. The normal UI asks what to find, what to do, and when to run.

The three proving cases are open GitHub PRs by an author, Linear issues by project/state/date with
conditional follow-up analysis, and newly created Rollbar error groups with fetched details.
These are examples, not a closed list of supported entity types.

## Survey findings

Line numbers below are baseline anchors, not stable API addresses. Read the surrounding module.

| Evidence | Consequence |
| --- | --- |
| `packages/protocol/src/collections.ts`, lines 69–117, defines flat fields and text/enum parameters. | Display cells cannot represent nested workflow data or a general typed query. |
| `plugins/linear/src/shared/collections.ts`, lines 34–92, projects state categories and chooses one label per category. | Exact provider states can be lost before filtering or automation. |
| `plugins/github/src/shared/collections.ts`, lines 16–83, derives one display status from several PR facts. | PR state, draft status, and merge readiness need separate record properties. |
| `plugins/github/src/server/routes/pulls/collections.ts`, lines 32–145, reads one search page or a bounded mirror selection. | Page exhaustion and freshness are not exposed as query completeness. |
| `plugins/linear/src/server/routes/linear.ts`, collection handler near line 278, suppresses connection errors. | Empty and incomplete results can be indistinguishable. |
| `packages/client-core/src/host/registries/sources/collections.ts`, lines 18–54, contains client-only option callbacks. | Loaded plugins and unattended readers do not have equivalent discovery capabilities. |
| `packages/node-core/src/server/collections/registry.ts`, lines 21–115, already provides a Node-side route registry and parsing. | Extend this ownership pattern instead of inventing another provider transport. |
| `plugins/workflows/src/shared/workflowContracts.ts`, lines 32–58, models inputs and literal bindings as strings. | Whole records, numeric values, and booleans cannot flow through child inputs. |
| `plugins/workflows/src/client/editor/WorkflowDispatchForm.tsx`, near line 242, uses `/tickets` as a placeholder. | The form suggests provider-specific behavior although the loop is generic. |
| `plugins/workflows/src/server/workflowBindings.ts`, lines 27–129, validates and freezes a map roster. | Preserve whole-roster validation and snapshot semantics while replacing pointer entry UI. |
| `plugins/workflows/src/server/workflowDispatch.ts`, lines 60–173, reserves identities before effects but forbids grandchildren. | Reuse reservation and reconciliation, extend lineage and budget enforcement. |
| `plugins/workflows/src/server/workflowBuiltins.ts`, near line 226, creates direct child-agent fan-out separately. | Consolidate batch execution rather than maintain two recovery paths. |
| `plugins/workflows/src/server/workflowStartService.ts`, lines 46–105, resolves and freezes the execution graph. | This remains the admission boundary for all run origins. |
| `plugins/workflows/src/client/editor/draftStore.ts`, lines 69–195, has in-memory drafts and revision-aware saves. | Recovery, publication, and conflict reconciliation need explicit persisted state. |
| `plugins/workflows/src/server/generateWorkflowRequest.ts`, lines 85–132, performs generation and one repair call. | Add bounded discovery and clarification around generation, not unrestricted execution. |
| `packages/node-core/src/server/modelProviders/types.ts`, lines 1–8, exposes text generation without tools. | Discovery must also work for text-only API and CLI backends. |
| `packages/node-core/src/server/dashboards/sampler.ts`, near line 90, consumes Node collections. | Dashboard migration includes unattended measure sampling, not just visible panels. |

## Data flow and ownership

The baseline path is provider API → owning plugin's credential/resource layer → collection route
→ Node or client registry → broker and client query cache → dashboard projection. Workflow loops
instead consume structured step JSON → string bindings → persisted roster → child dispatch records
→ core tasks and workflow runs → notices/cache invalidation → run UI. Generation has a third,
smaller catalog of executable kinds and saved workflows.

The proposed path is provider or core source → shared source runtime → typed records and query
result metadata. Dashboards project those records into cells. Workflow data steps persist them as
step output, then resolve typed bindings into the same durable dispatcher. AI and visual editors
read the shared source descriptions. They never read plugin databases or credentials directly.

| Owner | Responsibility |
| --- | --- |
| Protocol | Serializable data schemas, source descriptors, query DTOs, and typed-value contracts. |
| Node core | Source registration/discovery, bounded invocation, query library, dashboard publication/storage, scheduler, and core task operations. |
| Provider plugin | Connection-specific fields/options, upstream query translation, details, identity, and honest completeness/continuation claims. |
| Workflows plugin | Definition publication, graph resolution, typed data steps, dispatch, processing ledger, and workflow schedule target. |
| Dashboards core | Pure projection, display mapping, shaping, aggregation, and layout calculations. |
| Client core | Shared pickers/query editor, cache keys, host-rendered kit components, dashboard UI, and navigation. |
| Workflows client | Outline editor, workflow run UI, schedule configuration, and feature-owned draft state. |
| Broker and shell | Transport and host presentation. No source filtering, timers, credentials, or workflow execution. |

Core must not import workflow implementations. Workflow-owned publication participates through a
capability; source invocation is exposed through the facade. Share pure value/query helpers only
where multiple consumers exist. Do not create a general publishing or distributed-jobs framework.

## Accepted product decisions

This table records the decisions. Linked references own their implementation semantics.

| Area | Decision | Precedent or intentional departure |
| --- | --- | --- |
| Records | Preserve source-specific typed records and exact identities; no normalized work-item entity. | Extends host-stamped collection provenance; replaces its scalar-cell restriction. [Data](./data-contract.md). |
| Discovery | Declared and dynamically described fields, plus optional observed fields from explicit preview. | Replaces cache-dependent schema discovery and compiled-only options. [Data](./data-contract.md). |
| Querying | One source and explicit connection, bounded all/any groups, declared supported operations, honest completeness. | Replaces opaque string parameters and silent fallbacks. [Data](./data-contract.md). |
| Reuse | Inline queries plus a workspace saved-query library. Dashboard-only cross-source composition. | Follows panel definition/placement separation without making every query shared. [Publication](./publication.md). |
| Typed workflows | Typed values for all structured steps, field picker, explicit fallbacks, deterministic conditions. | Extends predecessor bindings and branch validation. [Workflow](./workflow-contract.md). |
| Children | Bounded nesting; one dispatcher for provider records and AI-produced arrays; finish independent children after failures. | Extends dispatch reservations and replaces direct fan-out/join. [Workflow](./workflow-contract.md). |
| Scale | Hundreds of children, up to 500 descendants per root, with lower execution limits and bounded concurrency. | Replaces the 12-task ceiling. [Workflow](./workflow-contract.md). |
| Drafts | Autosave drafts, publish before running, publish dependencies together after review. | New lifecycle built on revision-aware saves, not a second executable draft path. [Publication](./publication.md). |
| Files | Visual file editing with conflict review; publication writes but does not commit; export embeds queries. | Extends atomic file writes and repository trust. [Publication](./publication.md). |
| UI | Full authoring redesign, outline-led workflow editor, persistent dashboard preview, contextual AI proposals. | Reuses closed kit and graph capability, replaces modal-heavy composition. [Authoring UX](./ux-authoring.md). |
| Preview | Explicit query refresh, immediate display redraw; no simulated execution or special single-record run mode. | Replaces cold-cache dependence while avoiding accidental execution. [Authoring UX](./ux-authoring.md). |
| Scheduling | Integrate scheduling here, explicit timezone, skip overlap, capability-gated checkpoints. | Extends the Node scheduler and supersedes the previous programme. [Scheduling](./scheduling.md). |
| Repeat work | Per-schedule/per-loop history, selected-field changes, explicit retries, retain history across edits. | New business processing ledger separate from invocation idempotency. [Scheduling](./scheduling.md). |
| AI | Visual and AI authoring are peers; metadata first, opt-in record samples, inline clarification, reviewed edits. | Extends generate/ground/validate rather than bypassing validation. [AI](./ai-authoring.md). |
| Navigation | Record-first run table, children collapsed under root, individual archiving only. | Extends core task hierarchy without changing task ownership. [Running UX](./ux-running.md). |
| Transition | Migrate every collection consumer and remove old contracts; targeted development resets allowed. | Intentional breaking change, no indefinite adapters. [Verification](./verification.md). |

## Simplicity check

The main UI has source/query setup, the operation to perform, and optional scheduling. Technical
identity, hashing, pagination, and recovery bookkeeping stay in the implementation. Display settings
do not mutate records. Shared queries are optional. Unsupported operations remain explicit.

The review removed a universal work-item model, cross-source query joins, automatic failed-item
retries, a simulation engine, batch archiving, and duplicate fan-out execution. The shared data
contract has concrete dashboard, workflow, generation, and sampler consumers. The remaining
abstractions each have an owning runtime and an observable failure they prevent.

## Verify before building

Recheck the evidence table, plugin/facade export rules, scheduler behavior, and task archive lifecycle.
Read [verification](./verification.md) before changing persisted state. Do not modify unrelated
worktree edits or create a branch unless requested.
