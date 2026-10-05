# Provider data sources

This page covers workspace project context and the provider-specific behavior of Linear issues and
Rollbar error groups.

## Workspace project context

A source's optional `projectScope` declares its container parameter and record pointer, with kind
`repository` or `external-project`. GitHub uses `/repositories` and `/repository`; Linear uses
`/project` and `/projectId`. The Node restricts workspace reads and parameter options to linked
containers, including older queries with no repository selection. An empty set reads no records.
It stamps the unique local owner into `ref.projectId`, independently of projected columns. Repository
names match without case; tracker IDs match exactly within the selected account. Duplicate local
clones and workspace-wide tracker links do not imply a unique task owner.

The parameter must be a top-level string or string list; the record pointer must name a string.
Plugins declare external identity. They cannot supply the host-stamped local project ID in a page.

## Linear issues and Rollbar error groups

`linear/issues` requires an explicit connection and `/project` parameter. Project choices are
paginated and restricted to the workspace's links by the host. `/state/id` choices come from the
selected project's teams, with provider state IDs and labels preserved. The record keeps state name
and category separately. Two states in the same
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
