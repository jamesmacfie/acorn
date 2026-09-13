# Typed data and source contract

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [decisions and ownership](./context.md). All interface names below are proposed.

## Values and field descriptions

Use JSON values: strings, finite numbers, booleans, null, arrays, and plain objects. Missing is
distinct from null and is represented internally, never by a magic string. Preserve nested data;
do not flatten it into a dashboard cell model or stringify it at workflow boundaries.

Use one bounded structural schema representation with JSON Schema-compatible `type`, `properties`,
`required`, `items`, `enum`, and `additionalProperties`. Nullable fields permit null in their type.
Support primitive types, objects, and homogeneous arrays. Arbitrary unions, executable defaults,
remote references, recursive schemas, and embedded expressions are outside this version. Reject
unsupported schema constructs at registration or authoring, rather than pretending to validate them.
Adapt supported legacy agent output schemas explicitly and validate outputs on the Node.

Field metadata is separate from structural validation. Each entry identifies a JSON Pointer within
the record and supplies a label, optional description, display hint, query operators, sort support,
and optional choices. Display hints cover text, number/unit, boolean, datetime, enum/status, person,
and link. Display roles such as title, status, URL, and updated are optional hints, not record fields
the provider must invent. Dates use epoch milliseconds on this shared contract. Preserve upstream
identifiers as strings where they identify records or choices.

Pointers are stored implementation addresses. The UI offers a searchable field tree. Array fields
can be selected whole or as a loop source. Do not manufacture arbitrary array indices from a sample.
Additional object keys survive when allowed by the schema. Preview can expose them as observed
fields, but cannot infer query support, enum membership, identity, or requiredness from a sample.

## Source contribution

A source has `(pluginId, sourceId)` identity. Core binds plugin ownership. A compiled registration
and a loaded manifest descriptor resolve to the same Node registry. The loaded descriptor names an
owned handler route, not a client callback. Static declarations cover fixed sources; an optional
discovery handler enumerates dynamic sources in bounded pages. Discovered IDs remain stable across
refreshes and cannot claim another plugin's namespace.

The handler accepts a discriminated operation with these inputs and outputs:

| Operation | Input | Output |
| --- | --- | --- |
| Describe | Source reference, workspace/project context, optional connection, selected scope parameters. | Record schema, field metadata, typed scope parameters, supported operations, optional detail schema, capability revision. |
| Options | The same scope, field/parameter address, search text, cursor, page size. | Stable IDs and labels, next cursor or exhaustion. |
| Query | Validated query, frozen evaluation time, page cursor, execution or preview mode. | Records, schema revision, read time, pagination/completeness, optional completed incremental boundary. |
| Details | Exact record reference and requested detail projection. | Typed detail value and fetched time, or explicit not-found/error. |

Source descriptors provide a human name, singular/plural record labels, optional icon, connection
provider requirement, and optional default title/URL field addresses. Dynamic options can depend on
already selected parameters, such as project → available states. Parameter dependencies must be
acyclic and declared. Changing an upstream parameter revalidates dependent selections.

An absent details or incremental capability is ordinary metadata, not a broken source. A source
may be connectionless. Otherwise a query resolves exactly one connection belonging to the source's
declared provider. Do not select an arbitrary account when more than one matches.

## Records and query results

Use a record envelope containing `ref`, `data`, and optional display/action metadata. The host-bound
reference contains source identity, connection identity where relevant, and an opaque stable
`recordId`. Title changes, array position, or display mappings cannot change identity. Each source
documents its identity scope. Reject duplicate identities within one complete selection rather than
silently overwriting conflicting rows.

Retain existing host-dispatched row actions and content-link navigation. Validate action payloads
and keep their risk classification. A row cannot supply credentials, executable rendering code, or
unrestricted routes. Source data is a safe plugin projection, not a promise to expose every raw
provider response property.

Query responses distinguish:

- More pages available, with an opaque page cursor.
- Complete selection, with an exhausted result set.
- Intentionally bounded selection, satisfying a user-authored `take` and stable sort.
- Incomplete selection, with a typed cause such as upstream cap, provider failure, or host budget.

`take` means the first N of an explicitly ordered result, with record identity as the stable tie
breaker. It does not mean silently accepting whichever page arrived. Only exhaustion or satisfied
bounded selection is dispatchable. Preview pages are labeled previews and never prove full execution
completeness. Incomplete queries create no per-item tasks and advance no processing checkpoint.
Do not promise provider snapshot isolation where the upstream API does not offer it. Detect cursor
loops and duplicate/conflicting records, and expose documented consistency limitations.

## Query definition

A query stores a source reference, a connection binding if needed, typed scope parameters, an
optional predicate, ordered sort keys, and optional `take`. Predicates are `all`, `any`, or a field
comparison. Initial operators are equality/inequality, ordered comparisons, contains, membership,
and missing/present tests. The descriptor declares the supported subset per field and whether
all/any grouping is supported. Reject an unsupported group or sort as well as an unsupported field.

Operands are typed literals or the shared workflow binding vocabulary when used inside workflows.
Standalone saved queries declare typed parameters; a consumer supplies values. Saved queries do
not contain references to another workflow's step IDs. A relative time operand is structured data,
not an expression string. Supported time modes are absolute range, last duration, since local
midnight, and incremental continuation when supported. Resolve time once per query execution and
reuse it across pages and retries of that selection. Calendar modes retain an IANA timezone.

The source translates the query and guarantees its declared semantics. It may internally compose
provider calls or locally filter a fully bounded response, but must report any incomplete result.
The host does not invent a generic fetch-all fallback. Query filtering is distinct from dashboard
presentation mapping; a display column named In progress cannot silently replace a provider state ID.

## Discovery, caching, and drift

Provide core routes for source discovery/description/options/query/details and saved-query CRUD,
using the ordinary broker. Query invocation uses POST JSON rather than opaque URL parameter strings.
Provider handler paths stay private to the registry. The plugin facade exposes scoped operations
for approved workflow execution and other legitimate Node consumers.

Cache metadata and previews by Node, source, connection, workspace/project, resolved scope,
query/parameter digest, and schema revision where known. Invalidate on connection or plugin changes.
Do not build dynamic controls from unrelated cached panel rows. Keep metadata without fetching
records. Preserve the last preview while refreshing, but tag it with its originating query digest.
An obsolete response cannot replace a newer query's preview.

Compare consumer-used field paths, structural types, choices actually bound, and requiredness.
Unrelated additions and label changes are compatible. Removing a selected state ID, changing a used
field type, or removing a required path needs repair. Retain invalid references visibly; do not
drop filters, bindings, or group mappings. Optional absent values use the binding policy in the
[workflow contract](./workflow-contract.md).

## Authority and limits

Device authoring can discover sources only within the selected Node/workspace and permitted
connections. Workflow invocation resolves frozen query bindings through its approved execution
scope. This is not permission for a task-scoped caller to invoke arbitrary provider routes. Plugin
unload, permission revocation, or connection deletion makes the source unavailable and invalidates
new admissions. Credentials remain in the owning provider callback. Logs carry IDs, timing, counts,
and error codes rather than record bodies or query secret values.

Implementation defaults, chosen to bound the initial version rather than as provider guarantees:

| Limit | Default |
| --- | --- |
| Structural nesting | 12 levels; 256 described field paths. |
| Predicate | Four group levels; 50 comparisons. |
| Discovery/options page | 100 entries, with continuation. |
| Preview | 25 records per visible page. |
| Execution selection | 5,000 records and 16 MiB serialized data, whichever is reached first. |
| Single record/detail | 256 KiB record; 1 MiB details. Oversize is an explicit error. |
| Query execution | 60 seconds, at most 100 pages; lower source/request limits prevail. |

Do not truncate record contents to satisfy limits. These bounds belong in shared constants and
boundary tests. Raising them later is an intentional contract change, not a provider workaround.
Workflow child-admission limits are separate from query limits because most selected records may
already have been processed.

## First-party and installed proof

GitHub supplies actual PR state, author identity, draft status, and merge fields separately. Linear
supplies exact state IDs/names alongside optional categories and dynamic project-scoped options.
Rollbar initially supplies error groups, first occurrence time, and optional details. Occurrences
are not automatically dispatched as independent errors.

Move core tasks and agent sessions onto Node-owned sources as well. Do not invent a clean worktree
value when the source cannot obtain status; return a declared optional value. Keep pure dashboard
formatting and action navigation independent of provider code.

The installed fixture declares nested objects, arrays, a connectionless source, dynamic options,
an optional observed field, and error/oversize/incomplete modes. It must pass the same parser and
consumer tests as built-in sources. Publish its minimal authoring example and conformance tests
through the plugin toolkit instead of requiring internal imports.

## Verify before building

Recheck collection registration, manifest parsing, provider runtime scoping, toolkit generation,
and the Node sampler against [context](./context.md). Verify current upstream provider APIs during
adapter implementation before claiming filter or incremental capabilities.
