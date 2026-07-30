# Linear plugin migration

Status: **Normative**<br>
Coordinate: `acorn/linear`<br>
Requirement prefix: `CUR-LIN`

## 1. Current behavior and authoritative state

V1 Linear is a multi-connection external-item provider. Linear is authoritative for organizations,
teams, projects, cycles, users, issues, comments, relations and provider-side mutations. Acorn owns
connection records, encrypted credential references, workspace/project bindings, Task links,
promotion provenance and local presentation state. V1 `issues` and `issue_resources` rows are
serve-then-revalidate projections, not provider authority; detail freshness is independent of list
freshness and issue resources use a ten-minute TTL.

- **CUR-LIN-001:** V2 MUST retain connection-qualified identity for every Linear object. The
  canonical external reference contains provider coordinate, connection ID, stable Linear ID when
  available, display identifier such as `ENG-123`, and canonical URL.
- **CUR-LIN-002:** A bare display identifier MUST resolve only within an explicitly selected
  connection or deterministic workspace binding. Interactive search MAY offer V1-like first-hit
  convenience only after displaying and requiring confirmation of the selected connection before
  a mutation.

## 2. Current UI, routes, events, contributions, and dependencies

V1 contributes the Linear Fleet/workspace source, browse list, issue detail, linked-issue Task pane
(`meta+shift+l`), connection settings, project binding, task promotion/attachment, branch-name
suggestion, comments and content links detected in GitHub PR text. Detail presents description,
comments, activity, labels, priority, estimate, due date, branch, team, project, cycle, attachments,
parent/children and relations. Threaded comment creation preserves `parentId`.

Internal and `/api/v1/plugins/linear` routes cover projects, list, resolve, detail and comment.
There are no durable V1 Linear events; query invalidation and presentation intents update the UI.
GitHub currently imports `LinearIssuePanel` and `scanLinearRefs`; application composition imports
Linear view types and components.

## 3. Target V2 classification and trust/runtime tier

- **CUR-LIN-003:** Linear is an **Acorn Verified marketplace reference integration**, included but
  dormant in the default installation profile until configured. Its Node runtime is a WASI
  Component and its UI is declarative.
- **CUR-LIN-004:** Installing the default profile MUST NOT create a Linear account connection,
  request a credential or contact Linear. Those operations begin only through owner setup.

## 4. Node, Electron, native-host, and renderer split

| Layer | Responsibility |
| --- | --- |
| Node core | Connection IDs; opaque secret references; workspace/Task ownership; HTTPS and credential brokers; command/event/idempotency enforcement |
| Linear WASI component | GraphQL operation definitions; response validation; normalized projections; reference detection; comment semantics; promotion and branch policy |
| Electron | Fleet source, Task pane, navigation intents, settings and wizard hosting |
| Standard renderers | Lists, filters, Markdown detail, metadata, activity timeline, comments, forms, status, stale/error/permission states |

- **CUR-LIN-005:** Electron MUST receive normalized Linear documents only. Provider credentials,
  GraphQL transport objects, raw responses and executable UI MUST remain on the Node side.
- **CUR-LIN-006:** The component uses a destination- and purpose-bound HTTPS broker; it receives no
  raw token, ambient network, filesystem, process, terminal or provider-SDK authority.

## 5. Manifest, required capabilities, permissions, dependencies, and optional integrations

The manifest declares queries/actions/events below; a Fleet/workspace source; Task pane; settings
page; setup wizard; source-promotion, external-reference and navigation-intent contributions; and
standard renderer requirements. Required permissions are plugin storage, brokered Linear HTTPS,
opaque `linear.api-token` use, workspace/repository read, Task link read/write and Task create.
Comment write is a separate, visible permission from read access.

Linear has no required plugin dependency. It exports reference detection and context formatting.
GitHub is an optional consumer and MUST declare the dependency and event/capability grants; Linear
does not depend on GitHub. Agents/Context may optionally consume its context export.

- **CUR-LIN-007:** A permission grant is scoped to one Node installation and the selected Linear
  connections/workspaces. Adding comment-write, widening destinations or exposing new sensitive
  fields requires reapproval.

## 6. Queries, commands, exported capabilities, events, and streams

| Contract | Kind | Semantics |
| --- | --- | --- |
| `dev.acorn.linear.projects.list.v1` | query | Bounded projects for one connection |
| `dev.acorn.linear.issues.list.v1` | query | Filtered/paginated issue summaries plus freshness |
| `dev.acorn.linear.issue.get.v1` | query | Normalized issue detail |
| `dev.acorn.linear.reference.resolve.v1` | query | Connection-qualified `ExternalRef` |
| `dev.acorn.linear.comment.create.v1` | command | Create root/threaded comment with expected issue identity |
| `dev.acorn.linear.task.promote.v1` | saga | Create Task, link issue and apply branch suggestion |
| `dev.acorn.linear.task.link.v1` | command | Link existing Task to exact external reference |
| `dev.acorn.linear.connection.validate.v1` | command | Test credential/account and return safe identity |

Exports are `dev.acorn.linear.reference-detect.v1`, `context-format.v1` and
`branch-suggest.v1`. Detection accepts bounded text and recognizes exact
`linear.app/.../issue/TEAM-123` URLs; it does not scrape arbitrary links. Provider list/resolve
budgets cap batches and context items at 50.

- **CUR-LIN-008:** Events are `dev.acorn.linear.issue.refreshed.v1`,
  `comment.created.v1`, `workspace-binding.changed.v1` and `connection.health-changed.v1`.
  Payloads contain connection-qualified resource URIs, revisions and safe summary fields, never
  comments, descriptions, credentials or raw provider bodies.
- **CUR-LIN-009:** Comment creation is not intrinsically idempotent upstream. The Node MUST persist
  the Acorn idempotency key and committed provider result before reply; uncertain outcomes become
  `completion_unknown` and MUST be reconciled before retry.

Linear defines no byte stream. Large Markdown fields are bounded query values or object references.

## 7. UI contributions and renderer requirements

The source preserves connection/project filters, search, paginated issue rows, promotion and
attach-to-current-Task. The pane preserves multiple linked targets, explicit target selection,
description/metadata/activity/comments, comment composer and content-link navigation. Required
renderers are `acorn.list`, `acorn.detail`, `acorn.markdown`, `acorn.timeline`, `acorn.form`,
`acorn.settings`, `acorn.wizard`, `acorn.status` and all standard loading/empty/stale/offline/error
states.

- **CUR-LIN-010:** A refresh MUST preserve selected issue, comment draft, pane focus and scroll.
  An event may invalidate data but MUST NOT directly manipulate Electron presentation state.
- **CUR-LIN-011:** Mobile fallback is the same declarative browse/detail/comment flow with stacked
  layout. Missing comment or Markdown capability produces an explicit read-only or unsupported
  state; it never silently drops data or executes bespoke UI.

## 8. Storage, migrations, backup, uninstall, and reinstall behavior

The Linear plugin database owns normalized project/issue/resource cache, validators, list/detail
freshness, reference-detection cache and health state. Core owns installation, connection identity,
opaque secret references, workspace binding and Task links. Cache keys include connection identity;
raw GraphQL responses are never persisted.

- **CUR-LIN-012:** Plugin data migrations are transactionally backed up and health-gated. Failed
  migration rolls back the artifact and database; core connection/link state is unchanged.
- **CUR-LIN-013:** Disable stops refresh and mutations but retains visible stale links. Uninstall
  retains plugin database for 30 days by default; delete-now removes projections but does not
  delete Tasks or provider data. Reinstall of the same coordinate may adopt retained data after
  schema validation.
- **CUR-LIN-014:** V2 clean start imports no V1 Linear connections, tokens, caches, links,
  preferences or setup state.

## 9. Setup, settings, health, update, and failure behavior

The resumable wizard collects a label, accepts the API token through a write-only secret step,
validates viewer/workspace identity, selects projects, optionally binds Acorn workspaces and tests
a bounded read. Resume does not redisplay the secret. Settings manage label, project bindings,
read/comment grants, cache policy within host caps, retest, rotate and disconnect.

Health distinguishes offline Node, invalid/expired credential, permission denial, rate limiting,
missing project, provider-schema rejection and service outage. Updates preserve IDs/bindings/links
and stage Node/client artifacts together.

- **CUR-LIN-015:** Provider errors are normalized and retry hints bounded. A failed refresh serves
  an authorized stale projection with age; a failed mutation never presents optimistic state as
  committed.

## 10. Security and credential treatment

- **CUR-LIN-016:** The API token is application-encrypted by the core secret broker and represented
  to all plugin/client code as a write-only opaque reference. It is destination- and
  operation-bound when injected.
- **CUR-LIN-017:** Provider Markdown, attachment labels and URLs are untrusted content. Renderers
  sanitize markup, route navigation through intents and deny ambient requests/downloads.
- **CUR-LIN-018:** Logs/audits record connection ID, operation class, result, timing and quota—not
  token, query variables containing bodies, descriptions, comments or raw error payloads.
- **CUR-LIN-019:** Inter-plugin calls preserve caller identity and delegated permission. Reference
  detection cannot be abused to obtain issue detail or comment authority.

## 11. Existing coupling that must be removed

Remove GitHub imports of Linear scanner/panel, application imports of Linear view types, shared
generic `issues`/`issue_resources` tables, direct integration DB/secret access and presentation
event assumptions. Replace them with external-reference capabilities, provider-neutral navigation
intents, the Linear plugin database, brokered credentials, standard renderers and declared events.
GitHub emits bounded content to granted detectors; it never learns Linear implementation details.

## 12. Exact fresh-install visual and behavioral parity scenarios

- **CUR-LIN-020:** Multiple labeled connections browse independently; projects/issues retain
  stale-while-revalidate behavior, list/detail metadata, threaded comments and exact link identity.
- **CUR-LIN-021:** The Linear source and linked Task pane retain glyph/labels, shortcut, filters,
  target picker, promotion/attachment, branch suggestion and content-link navigation.
- **CUR-LIN-022:** A GitHub PR containing an exact Linear URL opens the correct issue without any
  GitHub-to-Linear import; denial/removal of that optional grant leaves standalone Linear intact.
- **CUR-LIN-023:** A remote Electron client performs the same flow against the owning Node; offline
  mode shows authorized cached state and disables mutation until reconnect.
