# Rollbar plugin migration

Status: **Normative**<br>
Coordinate: `acorn/rollbar`<br>
Requirement prefix: `CUR-RB`

## 1. Current behavior and authoritative state

V1 Rollbar is a read-only, multi-connection external-item provider. Rollbar is authoritative for
projects, items and occurrences. Acorn owns connection records, workspace/repository mappings,
Task links, normalized cache projections and presentation state. Item summaries use provider
counter as display identifier and system item ID for stable permalink identity. Legacy
counter-only links are resolved before use.

- **CUR-RB-001:** V2 MUST preserve Rollbar authority and connection-qualified identity. A cached
  summary/detail/occurrence is explicitly a projection with independent freshness.
- **CUR-RB-002:** Raw occurrence payloads are hostile sensitive input. They MUST cross a strict
  allowlist normalizer before persistence, rendering, events, diagnostics or logs.

## 2. Current UI, routes, events, contributions, and dependencies

V1 contributes a Rollbar Fleet source and linked-item Task pane (`meta+shift+o`). The source is a
two-column master/detail view of active items across mapped connections, fetching up to 300 items
then filtering project, level, environment and counter locally. Summary and metadata load first;
occurrence list loads when its tab opens; normalized diagnostic detail loads after selection.
Tabs are Summary, Details and Occurrences. Item/occurrence counters link to account-independent
permalinks.

Promotion creates a Task in the mapped repository/branch and focuses an existing Task rather than
duplicating it; attach-to-current is distinct. `/api/v1/plugins/rollbar` lists and gets items; the
internal resource runtime also owns item metadata, occurrence list and occurrence detail. V1 has
no durable product events and no write operation against Rollbar.

## 3. Target V2 classification and trust/runtime tier

- **CUR-RB-003:** Rollbar is an **Acorn Verified marketplace reference integration**, included but
  dormant in the default profile. It uses a WASI Component plus declarative UI.
- **CUR-RB-004:** The package requests read-only provider authority. A future provider mutation is
  a new permission, command schema and owner reapproval—not a hidden expansion.

## 4. Node, Electron, native-host, and renderer split

Node core owns connection IDs, secret references, mappings, Task links, HTTPS/credential brokering,
quotas and command/event semantics. The WASI component defines Rollbar API operations, validates
responses, normalizes summaries/metadata/occurrences and owns projection caching. Electron hosts
the source, pane, settings and wizard. Standard renderers display lists, metadata, stack frames,
bounded code context, tabs, links and degraded states.

- **CUR-RB-005:** No generic JSON viewer or bespoke UI is permitted for Rollbar diagnostics.
  Electron receives only the normalized schema.
- **CUR-RB-006:** The component receives no raw credential, generic network, process, filesystem,
  terminal or native authority. Brokered HTTPS is limited to declared Rollbar origins.

## 5. Manifest, required capabilities, permissions, dependencies, and optional integrations

The manifest contributes Fleet source, Task pane, connection settings/wizard, promotion,
external-reference navigation and health. Permissions are brokered Rollbar HTTPS, opaque token use,
plugin storage, workspace/repository reads, Task link write and Task creation. Renderer
requirements are list, tabs, detail, metadata, stack trace/code context, link, status and forms.

Rollbar has no required plugin dependency. Context/Agents may optionally consume a separately
declared normalized diagnostic summary; they receive neither occurrence bodies nor credentials.

- **CUR-RB-007:** Grants are scoped to selected connections/projects. Provider destination or
  normalized-field expansion requires a manifest/version change and privacy reapproval.

## 6. Queries, commands, exported capabilities, events, and streams

| Contract | Kind | Result |
| --- | --- | --- |
| `dev.acorn.rollbar.items.list.v1` | query | Bounded summaries, cap/freshness by connection |
| `dev.acorn.rollbar.item.get.v1` | query | Normalized metadata |
| `dev.acorn.rollbar.occurrences.list.v1` | query | Bounded occurrence summaries |
| `dev.acorn.rollbar.occurrence.get.v1` | query | One normalized allowlisted diagnostic |
| `dev.acorn.rollbar.reference.resolve.v1` | query | Stable item reference from ID/counter |
| `dev.acorn.rollbar.task.promote.v1` | saga | Task creation/link or existing-Task focus |
| `dev.acorn.rollbar.task.link.v1` | command | Attach exact item to Task |
| `dev.acorn.rollbar.connection.validate.v1` | command | Safe project/account validation |

The optional export `dev.acorn.rollbar.diagnostic-summary.get.v1` returns bounded normalized
summary only. There is no Rollbar mutation or continuous stream.

- **CUR-RB-008:** Events are `dev.acorn.rollbar.item.refreshed.v1`,
  `task-link.changed.v1`, `connection.health-changed.v1` and
  `normalization.rejected.v1`. They contain resource URI, revision, safe counters/classification
  and truncation flag; no occurrence, person, stack, request or raw error body.
- **CUR-RB-009:** Reads cap pages, items, occurrences and bytes. List membership is stamped by the
  completed list refresh; detail refresh MUST NOT incorrectly refresh list membership.

## 7. UI contributions and renderer requirements

Preserve the source’s master/detail layout, connection/project/status/level/environment filters,
selection, counts, promotion/attach actions and explicit stale state. Preserve Task-pane
Summary/Details/Occurrences tabs, lazy occurrence loading, stack/code-context presentation,
truncation notice and safe external links.

- **CUR-RB-010:** Refresh and tab loading MUST preserve selection, focus and scroll and MUST NOT
  prefetch sensitive occurrence detail merely because a summary is visible.
- **CUR-RB-011:** Mobile fallback is a stacked item/detail/occurrence list using the same semantic
  schema. Missing stack renderer shows a bounded text fallback or explicit unsupported state.

## 8. Storage, migrations, backup, uninstall, and reinstall behavior

The plugin database owns normalized item, metadata and occurrence projections, validators,
freshness and privacy-safe health. Core owns connections, opaque credential references, mappings
and Task links. Raw provider values never enter SQLite, blob cache, query cache or backup.

- **CUR-RB-012:** Normalization strips control characters and caps strings at 8 KiB, trace chains
  at 10, frames at 200, code lines per frame at 7 and diagnostic detail at 192 KiB. When reducing
  further, person email is dropped first and `truncated: true` is set.
- **CUR-RB-013:** Uninstall retains normalized plugin data 30 days by default; delete-now removes
  it without deleting Tasks/provider data. Disconnect removes that connection’s cache and leaves
  Task links visibly unavailable. Reinstall may adopt retained data after schema/privacy version
  validation.
- **CUR-RB-014:** V2 imports no V1 Rollbar connection, token, cache, Task link or preference.

## 9. Setup, settings, health, update, and failure behavior

The resumable wizard accepts a write-only access token, validates account/project visibility,
selects projects and optionally binds a default project to a workspace. Settings manage label,
project mappings, retest, rotation and disconnect. Health distinguishes offline, expired token,
permission denial, rate limit, missing project, provider outage and normalization/schema failure.

- **CUR-RB-015:** A normalization failure fails closed for the affected item and emits a
  privacy-safe health fact. Support diagnostics MUST NOT attach the rejected payload.
- **CUR-RB-016:** Updating a normalizer may narrow fields silently, but widening its allowlist or
  data classification requires explicit privacy review, schema version and owner reapproval.

## 10. Security and credential treatment

The retained allowlist is exception class/message; bounded frames/code context; request method and
URL without headers/body/query values; context/environment/code version/platform/language/
framework; server host/branch; notifier name/version; and minimal person ID/username/email.
Headers, cookies, query values, request bodies, IPs, locals/arguments, arbitrary custom/extra,
telemetry and raw crash reports are always discarded.

- **CUR-RB-017:** The token is application-encrypted and injected only into approved Rollbar
  requests. Plugin UI and WASI code receive an opaque handle, never plaintext.
- **CUR-RB-018:** Provider strings/URLs are untrusted; render as text and broker navigation. Audit
  records operation class/result/counts only.
- **CUR-RB-019:** Hostile-fixture conformance MUST prove dropped fields cannot enter UI documents,
  patches, caches, events, logs, crashes, audits or encrypted backups.

## 11. Existing coupling that must be removed

Remove application imports of Rollbar components/types, shared generic `issues` tables, direct
provider-resource DB access and provider-specific promotion wiring. Replace them with manifest
contributions, plugin storage, external-reference/Task capabilities, normalized contracts and
standard renderers. Core remains unaware of Rollbar response shapes.

## 12. Exact fresh-install visual and behavioral parity scenarios

- **CUR-RB-020:** Multiple mapped connections produce the same bounded active-item source,
  two-column desktop flow, filters, cached summary/detail and lazy occurrence behavior.
- **CUR-RB-021:** Task promotion/focus-existing, attach-to-current, pane shortcut/tabs and stable
  item/occurrence links match V1.
- **CUR-RB-022:** Synthetic secrets in every discarded provider field never survive normalization;
  visible truncation replaces silent omission when caps fire.
- **CUR-RB-023:** Remote/offline Electron shows authorized stale normalized data, never raw cached
  payloads, and resumes through event replay or snapshot without duplicate Task creation.
