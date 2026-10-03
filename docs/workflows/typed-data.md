# Typed data and conditions

This page covers the three built-in step kinds that read typed data or branch on it: `find-records`,
`get-record-details`, and `if`. They use the shared [data source](../data-sources.md) contract.

## Typed data and conditions

`find-records` takes a `query` inline or saved-query reference. It resolves input and predecessor
bindings, persists the resolved query and evaluation time before the source call, and reuses them
on retry. The source runtime validates and exhausts the selection. Only complete or deliberately
bounded selections produce a successful step. Structured output holds `records`, completeness,
schema revision, evaluation/read times, and resolved-query `provenance`. Its serialized size is
bounded to 16 MiB. Incomplete or oversized results cannot start dependent steps.

`get-record-details` takes a typed `record` binding to an exact `ref`, plus optional `projection`
pointers. Host-produced references retain source scope for dynamic discovery. Output contains the
reference, typed `data`, validated `schema`, and `fetchedTime`; not-found fails the step. References
identify records by plugin, source, connection, and record ID. Their carried scope is retrieval
context, not an additional identity component.

`if` takes a shared typed `condition` predicate and `branches` with `true` and `otherwise` targets.
Both targets must wait on the condition's stable step ID. The shared comparison rules preserve
missing versus null and allow explicit presence tests or fallbacks. The runner skips the untaken
branch and propagates skips through the graph. No model runs. `decide`, labelled **Ask AI to decide**,
remains a separate agent step.

Data calls use the workflow task's workspace and project, with a Node-created owner invocation.
Workspace queries retain their authored scope; explicit project restrictions must match the task.
Every invocation rechecks source and connection authority. Task credentials gain no provider route
access. Incremental checkpoint advancement uses the processing ledger described below.

The inspector uses client-core's shared source/query editor for `find-records` and its typed binding
picker for record inputs. Source metadata drives connections, parameters, filters, options, preview,
and nested inspection; the workflow plugin stores only the resulting protocol values. Conditions
remain a typed JSON repair surface until the outline-led workflow editor phase. Generation uses the
same descriptions and validation. Repository TOML uses `query_json`, `record_json`, and
`condition_json` for these structures.
