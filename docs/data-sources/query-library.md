# Workspace query library

Saved queries let a workspace publish a typed query once and reference it from dashboards, workflows,
and schedules. This page covers the stored model, the routes, and how consumers resolve a query.

## The library

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
query. Publication returns the affected consumers for the publishing feature to notify.

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
