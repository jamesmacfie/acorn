# Typed data sources

A data source is a typed, queryable set of records that a plugin serves through the Node, such as
GitHub pull requests, Linear issues, or agent sessions. Workflows and dashboards read every record
through this one contract. Read this page for registration, the routes, and the limits. The contract
is `packages/protocol/src/data/dataSources.ts`, with schemas, values, and field bindings in the
companion typed-data modules. Connections and credentials belong to [integrations](./integrations.md).

The Node owns source registration and bounded reads. Providers return typed nested records through
their own plugin routes. Core tasks, managed agent sessions, GitHub pull requests, Linear issues, and
Rollbar error groups are all sources. A core task's `worktreeChanged` stays `null` until the Node
has inspected its worktree. The agent sessions source reads every unarchived session through the
store's cursor, up to the host's 5,000-record budget, and reports `incomplete` with `host-budget`
when more remain. No client registers a source or discovers a schema on its own.

## Identity, reach, time, and coverage

A source can declare an `identity` operation. The Node requests its optional account facts (`id`,
`login`, `name`, `email`, `teamIds`, `teams`) for the selected connection, caches them by plugin and
account, and clears the cache when that connection changes. Identity remains on the Node. A field's
`viewerMatch` pointer names the identity member used by the editor's **You** value; the host resolves
that context binding to a literal before calling the provider. Sources should also expose native
viewer relationships as ordinary fields when the provider can compute them.

Scope parameters can be lists with dynamic choices. An omitted optional scope means the reach stated
in `consistency`; a chosen list limits it. `workspaceLinks` resolves to external IDs linked to the
query's selected workspace and account, including GitHub repository facets on local projects. Record
identities must include their distinguishing scope (a repository with a repository-local number, for
example). An account-wide source says so in its description rather than implying one project.

`context` bindings include `viewer`, `workspaceLinks`, `now`, and `calendar`. The Node resolves them
once at the run's evaluation instant and time policy. `now` accepts ISO 8601 day or week offsets;
`calendar` accepts day, week, or month offsets from a local boundary. Fields with `precision: 'day'`
carry `YYYY-MM-DD`, and comparisons to context instants use the plan's local date.

Descriptions declare snapshot or event coverage. Event coverage can state retention, earliest time,
and whether the history is complete. A read can report its covered range and observation time. A
dashboard warns when a requested lower time bound precedes verified coverage, marks the run
incomplete, and gives the oldest observation time as its **as of** label. Coverage diagnostics remain
available to later summary operations; they must keep partial results partial.

The source's `coverage` declaration describes snapshot versus event semantics. A dataset description
also carries `coverageWindows`, its stored complete and gap windows. The two fields are distinct:
a successful capture time does not prove the provider's event window was complete.

Query content can carry a structured `timeWindow` with a field pointer and an `absolute`,
`last-duration`, or `since-local-midnight` window. Calendar windows require a valid IANA timezone.
Resolution creates ordinary half-open timestamp comparisons at one evaluation instant. Workflow
execution freezes that instant and the resolved query across retries. Incremental queries use a
source-declared continuation contract and the workflow processing ledger described below.

The host stamps each returned record reference with its retrieval `scope`, including dynamic source
parameters. Scope is context, not record identity. Details keep that scope and connection, and return
the validated detail schema beside the data and fetch time.

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

A source description may include up to 10 `starterPlans` for dashboard authoring, each a version 2
panel plan. A starter's scope names no workspace or account. The panel launcher and the source
inspector move it onto the scope the person picked, then the Node validates it before it's offered.
Workspace tasks, Local worktrees, Agent usage records, and GitHub pull requests ship starters. Each
sits next to its source's description, with a test that validates it against that description.
Static field choices may declare a `tone` and
numeric `rank`; panel columns inherit these until the author overrides them. The source query
contract does not yet offer projection lists; source-side projection belongs to the later report
volume milestone.

A description may also declare `relations`: a named target source, relation kind (`implements`,
`blocks`, `belongs-to`, `references`, or `equivalence`), cardinality, and exact pairs of scoped key
fields. Scope components identify provider, account, identity, and any required container. The host
checks the declaration and reads the target through the same data-source runtime under the caller's
authority. Lookup and children relations attach data to primary rows; an equivalence states that
two primary records are the same item. It is the only relation that merges rows. No relation guesses
from labels or names, and a cardinality violation does not duplicate a row.
For example, GitHub's local-branches source declares a many-to-one lookup into pull requests using the
selected GitHub connection, tracked remote repository (or origin without upstream), and exact head
branch. The pull source exposes the head repository separately from its base repository. Local
branches without a matching PR remain,
and multiple matching PRs produce a warning with no arbitrary attachment.
The GitHub source delegates scoped Git reads to core through the source API; core has no dependency
on the plugin or its relation.

## Operations and transport

Use POST JSON under `/v1/core/data-sources`. The `list` body is a scope, and `discover` adds a plugin
and discovery ID. The other routes require a matching `operation` discriminator:

| Route | Request | Response |
| --- | --- | --- |
| `describe` | Source and scope. | Structural schema, field metadata, parameter schema, supported operations, revision, and consistency statement. |
| `options` | Source, scope, field or parameter pointer, search, cursor, and page size. | Stable IDs, labels, and either exhaustion or a next cursor. |
| `query` | Typed query, mode, evaluation time, cursor, and page size. | Host-bound record references, typed data, revision, read time, and completeness. |
| `details` | Exact record reference, scope, and projection. | Typed detail data and fetch time, or `not-found`. |
| `actions` | Exact full record reference and matching scope. | Current named actions for that record. |

Device and service principals can call read routes. Task principals cannot, and field moves require a
device principal. Node consumers use
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

A record can also declare a plugin-owned `{ kind, item }` target and named `actions` with IDs, labels,
optional icons, verbs, and risk tiers. `describe` lists the action IDs and target kinds the source can
offer; this is authoring metadata, not current eligibility. The source's `actions` operation answers
for one full record reference at press time. The Node checks the reference's scope and connection,
then checks the current action ID and risk before it dispatches a confined plugin route. Record verbs
also include `navigate` and `createTask`; host navigation and task creation use the row's project
context. A source that declares no named actions needs no `actions` handler.
For `runNodeAction`, the plugin receives the press's idempotency key and must deduplicate any side
effect by that key; a transport failure after dispatch can be retried without a stored response.

A source can also declare `writable` fields with an exact field pointer, its own confined plugin route,
a write or execute risk tier, and a finite set of typed target values. A writable source must support
`details`, which supplies the field's live value. Dashboard field moves use the same core `act` route
as named actions. The request contains a full record reference, field pointer, expected value, target
value, risk tier, and idempotency key. The Node checks the current declaration, account, exact scope,
live value, target, and route before dispatch. The plugin receives the same idempotency key and must
deduplicate a side effect if a transport failure occurs after dispatch. GitHub pull requests declare
`/state` writable for `open` and `closed`; `merged` remains read-only. A record and its `details`
response can narrow the declared writable fields, so the board refuses a move before dispatch and
the Node rechecks that eligibility against the current record.

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
