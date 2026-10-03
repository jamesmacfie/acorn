# Typed data sources

A data source is a typed, queryable set of records that a plugin serves through the Node, such as
GitHub pull requests, Linear issues, or agent sessions. Workflows and dashboards read every record
through this one contract. Read this page for registration, the routes, and the limits. The contract
is `packages/protocol/src/data/dataSources.ts`, with schemas, values, and field bindings in the
companion typed-data modules. Connections and credentials belong to [integrations](./integrations.md).

The Node owns source registration and bounded reads. Providers return typed nested records through
their own plugin routes. Core tasks, managed agent sessions, GitHub pull requests, Linear issues, and
Rollbar error groups are all sources. No client registers a source or discovers a schema on its own.

The host stamps each returned record reference with its retrieval `scope`, including dynamic source
parameters. Scope is context, not record identity. Details keep that scope and connection, and return
the validated detail schema beside the data and fetch time.

A query can carry a structured `timeWindow` with a field pointer and an `absolute`, `last-duration`,
or `since-local-midnight` window. Calendar windows need a valid IANA timezone. Resolution produces
half-open timestamp comparisons at one evaluation instant. Workflow execution freezes that instant and
the resolved query across retries.

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
intents. [Record processing history](./workflows/record-history.md) has the transaction and recovery contract.

## Pages

<a id="client-cache-and-conformance"></a>
<a id="shared-authoring-controls"></a>

- [Authoring controls](./data-sources/authoring-controls.md) covers the client cache, the conformance
  fixture, and the shared source and query editor.

<a id="workspace-query-library"></a>

- [Workspace query library](./data-sources/query-library.md) covers saved queries.

<a id="linear-issues-and-rollbar-error-groups"></a>

- [Provider data sources](./data-sources/provider-sources.md) covers Linear issues and Rollbar error
  groups.
