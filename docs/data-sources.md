# Typed data sources

Query content can carry a structured `timeWindow` with a field pointer and an `absolute`,
`last-duration`, or `since-local-midnight` window. Calendar windows require a valid IANA timezone.
Resolution creates ordinary half-open timestamp comparisons at one evaluation instant. Workflow
execution freezes that instant and the resolved query across retries. Incremental queries use a
source-declared continuation contract and the workflow processing ledger described below.

The host stamps each returned record reference with its retrieval `scope`, including dynamic source
parameters. Scope is context, not record identity. Details preserve that scope and connection and
return the runtime-validated detail schema beside data and fetched time.

The Node owns source registration and bounded reads. Providers supply typed nested records through
their own plugin routes. The shared contract is `packages/protocol/src/data/dataSources.ts`; schemas,
values, and field bindings use the companion typed-data modules.

## Register a source

A compiled plugin calls `ctx.dataSources.register` with a `sourceId`, human labels, `identityScope`,
and an owned handler path. A loaded manifest puts the same descriptor in `contributions.dataSources`.
The host binds `pluginId` and sends both carriers through the same registry and response validation.
Handlers remain private to the Node registry. Reload and disable clear registrations and discovered
IDs through the plugin host's normal lifecycle.

Optional `providerId` declares the source's connection provider. Each invocation selects one
`connectionId`; no default account is inferred. The host checks provider ownership, active identity,
connection ownership, and connection status before dispatch. Source callbacks receive a provider
runtime confined to that connection. `providers.connections` and `providers.withConnections` expose
only that connection, and `providers.resource` refuses another connection. The cross-connection item
store is unavailable in source callbacks. Connectionless callbacks have no provider credential access.

For dynamic sources, register `ctx.dataSources.discover` or `contributions.dataSourceDiscoveries`.
Discovery returns at most 100 descriptors per page. The host binds their plugin, handler, and provider;
each discovered ID is available only in the exact workspace, project, connection, and parameter scope
that discovered it. Refreshing discovery cannot replace a static descriptor.

## Operations and transport

Use POST JSON under `/v1/core/data-sources`. The `list` body is a scope, and `discover` adds a plugin
and discovery ID. The other routes require a matching `operation` discriminator:

| Route | Request | Response |
| --- | --- | --- |
| `describe` | Source and scope. | Structural schema, field metadata, parameter schema, supported operations, revision, and consistency statement. |
| `options` | Source, scope, field or parameter pointer, search, cursor, and page size. | Stable IDs, labels, and either exhaustion or a next cursor. |
| `query` | Typed query, mode, evaluation time, cursor, and page size. | Host-bound record references, typed data, revision, read time, and completeness. |
| `details` | Exact record reference, scope, and projection. | Typed detail data and fetch time, or `not-found`. |

Device and service principals can call these routes. Task principals cannot. Node consumers use
`ctx.dataSources.invoke(request, { principal, signal })`; the host-created principal passes unchanged
to the provider route. Loaded consumers can invoke only their own sources. The result type follows
the request's operation, so consumers do not cast a union to access query records.

Query operands at this boundary are resolved literals. Left operands reference an item field.
The host checks structural types, field capabilities, grouping, static choices, parameter dependencies,
and sort support before querying. Providers implement their advertised filtering and ordering semantics.
The host does not fetch every provider record to emulate unsupported filtering.

Records carry `recordId` and `data`, with optional `display`, `taskId`, and the established host-dispatched
row action. The host stamps source and connection identity. It rejects supplied provenance, foreign
action routes, and non-HTTP action URLs. Records retain nested objects, arrays, nulls, and allowed
additional properties. Presentation metadata cannot change record identity.

## Completeness and limits

Execution reads at most 100 pages within 60 seconds. It stops at 5,000 records or 16 MiB of serialized
record data. A record is limited to 256 KiB; details are limited to 1 MiB. Oversize values fail instead
of being truncated. Callers can lower the timeout. Providers report their own lower bounds as
`incomplete` with `upstream-cap` or `provider-failure`.

`more` includes a cursor. `complete` means exhaustion. `bounded` requires an explicitly sorted `take`
whose exact count has been satisfied. Host budgets return `incomplete` with `host-budget`. The host
rejects repeated cursors and record identities across execution pages, revision changes, and invalid
incremental boundaries. Consumers dispatch only execution results that are complete or bounded.

Preview returns one page of at most 25 records and retains `mode: "preview"`. A preview does not prove
that an execution is complete. Evaluation time stays fixed across all pages. Timeout and cancellation
release the caller even if a plugin callback ignores its abort signal; callbacks must still cancel
their own upstream work when signalled.

## Incremental continuation

A source that declares `operations.incremental` also describes deletion handling, late visibility,
token expiry, and the meaning of its completed boundary. Queries carry `incremental` with either
`{ kind: "baseline" }` or `{ kind: "continue", boundary }`. The source owns the opaque boundary;
the host does not convert timestamps or page cursors into checkpoints.

A complete incremental execution returns `incrementalBoundary`. The runtime rejects a boundary
on a preview, an incomplete page, or a source without the capability. Incremental queries cannot
use `take`. A page-budget failure returns no boundary. The portable fixture proves baseline,
continuation, zero-match continuation, and explicit expired-token failure; GitHub, Linear, and
Rollbar do not declare incremental support.

The workflow ledger commits that boundary with the selected record decisions and reserved child
intents. For the transaction and recovery contract, see [Record processing history](./workflows.md#record-processing-history).

## Client cache and conformance

`packages/client-core/src/features/dataSources/queries.ts` builds keys from Node, plugin, source,
connection, workspace, project, resolved parameters, operation digest, and revision. Connection and
plugin change watchers invalidate matching keys while retaining cached values. Each response belongs
to its full request key, so a response from an obsolete request cannot replace another query's cache.

The portable example is `apps/node/test/__fixtures__/typed-source/node.mjs`. Its manifest registers a
connectionless nested source and dynamic discovery. Modes cover malformed, oversized, incomplete,
duplicate, looping, failing, and nonresponsive reads. The Node conformance tests load its manifest
through the actual schema, synthesize registrations through `initPlugins`, and exercise core POST
routes. They separately register the handler as compiled code and compare records. These tests cover
the registration and route boundary; package installation and worker-process isolation belong to the
programme's final acceptance checks.

Core tasks and managed agent sessions use this same Node-owned contract. A core task's
`worktreeChanged` value is nullable and remains `null` until the Node has actually inspected that
worktree. The agent sessions source reads every unarchived session through the session
store's cursor, up to the host's 5,000-record selection budget, and reports `incomplete` with
`host-budget` when more remain. GitHub pull requests, Linear issues, and Rollbar error groups are provider-backed sources.
No client registration or cold-cache schema discovery path exists: every consumer describes and
queries through this runtime.

## Shared authoring controls

`packages/client-core/src/features/dataSources/SourceQueryEditor.tsx` is the host-owned source/query
editor used by workflow and dashboard authoring. It reads the source catalog,
connections, descriptions, dependent options, and saved-query library through core routes. Provider
plugins contribute descriptors and handlers only; they do not ship forms.

The editor keeps connection scope visible, clears dependent choices and filters when an upstream
parameter changes, and renders only declared operators and typed operands. Dynamic option search is
a metadata read. Record reads happen only when the user chooses **Refresh preview**. The previous
preview remains visible after query edits or a failed refresh and is labelled out of date by its
query digest. A request generation prevents an older response from replacing a newer preview.
Preview rows preserve nested data and identify observed fields without assigning them query support.

Saved queries use the same surface. **Edit saved query** writes the core-owned draft with the existing
750 ms compare-and-swap autosave and device recovery copy. A conflict retains both versions and
offers reload or **Customize for this use**; customization detaches an inline copy and does not alter
the saved query. Unpublished and unavailable saved queries remain visible for repair.

`TypedBindingPicker.tsx` is the corresponding typed field-picker API. Consumers pass admitted
workflow inputs, a current item, and predecessor results with structural schemas and optional
examples. The picker searches labels and JSON Pointers, includes whole objects and arrays, orders
compatible fields before explicit conversions and incompatible fields, labels observed and optional
paths, and says **No preview value** when no example exists. It never invents array indices or parses
arbitrary strings into another type. Required destinations can retain a typed fallback.

The compiled UI surface is `@acorn/plugin-api/ui/data-sources`. It is a lazy entrypoint so consumers
that do not author typed data do not load the editor. A feature-owned kit seam maps that same control
tree to DOM or terminal primitives; neither host reimplements editor rules.

`AuthoringConversation` is the shared AI conversation control for query, workflow, and dashboard
drafts. It sends only the selected scope, draft, bounded conversation, and model choice. The Node
executes model-requested source listing, dynamic discovery, description, and option operations through
the same source runtime as the visual editor. Preview records require an explicit checkbox and use
the ordinary preview route with a limit of three records and 16 KiB. Query proposals return through
`SourceQueryEditor`, which resolves the candidate with the normal query validator before applying one
undoable edit.

## Workspace query library

Core stores query drafts, immutable published revisions, and consumer references in its normal
SQLite migration chain. The contract is `packages/protocol/src/data/queries/dataQueries.ts`. Each query belongs
to a workspace and can be restricted to one project. Project reads include workspace-wide queries;
workspace-wide reads do not expose project-restricted queries. Scope cannot change through a save.

Query content contains a name, a closed object schema for declared parameters, a source query,
explicit `sourceParameters` bindings, and an optional connection binding. Literal source parameters
remain ordinary data. Explicit bindings overlay named source parameters. Saved content can address
only its own declared inputs; a consumer's outer bindings can address its admitted inputs, predecessor
outputs, or current item. `packages/protocol/src/data/queries/dataQueryResolution.ts` resolves bindings without
string coercion. The consumer controls which predecessor outputs enter that context.

POST JSON to `/v1/core/queries/:operation`, with the matching `operation` and `scope` in the body.
Operations are `list`, `get`, `create`, `save`, `publish`, `published`, `delete`, `consumers`,
`consumer`, and `resolve`. Saves, deletes, and publication require `expectedRevision`. Conflicts
return 409 and preserve the stored draft. Drafts can retain unavailable sources and broken references
for repair. Publication validates declared types, source capabilities, and selected dynamic options
without reading records. Dynamic validation is bounded to 100 option pages per selection and
60 seconds for the publication validation. `validationParameters` supplies discovery values and does
not persist defaults. Missing or unresolved metadata prevents publication.

Consumers store either inline content or a saved query ID with typed bindings. Omitting `revision`
resolves the published pointer. Runs retain the returned `ResolvedQuery`, including the exact
`QueryRevision`, digest, source revision, and resolved parameter values. Draft edits do not move the
published pointer. Published content remains readable after an unreferenced draft is deleted.
Resolution revalidates source availability and choices; a retained snapshot itself needs no source
connection to inspect. Failed publication does not change the published pointer.

Node plugins use `ctx.dataSources.resolveQuery` and `ctx.dataSources.setQueryConsumer`. The host
stamps the registering plugin on consumer references; loaded plugins can resolve only their own
sources. The `consumer` HTTP operation requires a device principal. Other operations accept device
and service principals and refuse task principals. Consumer records support panel, workflow, and
schedule impact links, including references to unpublished drafts. Deletion refuses any referenced
query. Publication returns affected consumers for the publishing feature to notify; schedule graph
review and cross-database publication coordination belong to their later workflow-v2 phases.

Published dashboard panels register one `panel` consumer for every saved query they reference.
Dashboard rendering intentionally resolves an unpinned saved reference to its latest publication, so
publishing that query changes the next panel refresh and the query publication response names the
affected panel. **Customize for this use** replaces the consumer reference with an inline copy;
display mappings never alter either query form.

`packages/client-core/src/features/queries/queriesClient.ts` supplies the client service.
`packages/client-core/src/features/queries/recoveryStore.ts` retains device copies by Node, entity,
and base revision, including discovery after reopening against a newer Node revision. It clears a
copy only after a matching acknowledgment or explicit discard. A late acknowledgment cannot erase
subsequent edits. Storage failure reports `not-saved`; a local write reports `saved-on-device`.
The 750 ms autosave constant and recovery states support the editor phase; this slice adds no editor.

## Linear issues and Rollbar error groups

`linear/issues` requires an explicit connection and `/project` parameter. Project choices are
paginated. `/state/id` choices come from the selected project's teams, with provider state IDs and
labels preserved. The record keeps state name and category separately. Two states in the same
category remain distinct choices. A state from another project's teams fails validation.
Project, exact state, and created/updated date predicates narrow the Linear GraphQL query.
The records include issue descriptions and archived issues. Dates use epoch milliseconds.

`rollbar/error-groups` selects deduplicated items in one project connection. Its record identity
combines the system item ID and immutable project counter. Status, level, and environment predicates
narrow the REST request. First-seen and last-seen predicates run after candidate exhaustion because
the REST items endpoint does not declare those date filters. First-seen selection excludes a group
created before the boundary even when it receives another occurrence afterward.

Both adapters read at most 5,000 candidates and report incomplete selections when that limit prevents
exhaustion. Numeric date sorts use record identity to break ties. Sorted `take` applies after
exhaustion, so a candidate cap cannot become a dispatchable first-N selection. Pages retain the
selected records for 60 seconds and bind continuations to owner, source, scope, query, and evaluation
time. Each read checks the principal and connection, including retained pages. Neither source
claims snapshot isolation or incremental checkpoint support.

Rollbar details use the provider's metadata and occurrence resources. The response contains the
group and a safe projection of its newest occurrence's message, exception, and stack frames.
Occurrences are not an independent queryable source. Missing items return `not-found`; resource
failures and truncated projections fail the read. Projected strings are limited to 8 KiB, and the
shared detail byte limit applies. Raw request headers, bodies, and person data are excluded.
Detail calls check cancellation between resource reads; an in-flight provider resource refresh
uses the resource layer's own lifecycle. Query HTTP calls receive the request abort signal.

The plugin API's `createDataSelectionPager` handles ephemeral retained pages. Its caller must
reauthorize every invocation and validate the candidate selection before retaining it.
`dataComparisons` and `selectDataRecords` support literal comparisons in `all` groups and numeric
sorting. They do not implement a host query fallback or advertise provider capabilities.

Provider API references checked on September 13, 2026:

- [Linear filtering](https://linear.app/developers/filtering), [pagination](https://linear.app/developers/pagination), and [official GraphQL schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql).
- [Rollbar item listing](https://docs.rollbar.com/reference/list-all-items), [item identity](https://docs.rollbar.com/reference/get-an-item-by-id), and [occurrence listing](https://docs.rollbar.com/reference/get_api-1-item-item-id-instances).
