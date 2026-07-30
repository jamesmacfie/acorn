# View sessions, bindings, actions and patches

Status: Normative<br>
Requirement prefix: `UI-VIEW`

A view session is a short-lived Node authorization and state boundary for one mounted contribution.
It is not a general plugin socket and does not replace command authorization.

## Open

Electron submits core command `acorn.core.view.open.v2` with Node,
installation/generation, contribution, host surface, canonical resource context, client renderer
capabilities, locale, size class and optional resumable token. The terminal command result is
followed by the AsyncAPI `view.snapshot` frame containing `view-session-v2` plus the initial
`ui-document-v2`. `acorn.core.view.resume.v2` performs the same authorization and rotates the view
capability after reconnect.

- **UI-VIEW-001:** Node MUST authorize the paired client, active installation/generation,
  contribution availability and each resource before opening.
- **UI-VIEW-002:** `sessionId` is a non-authoritative UUIDv7 resource identifier. The separately
  returned capability is 256 random bits encoded as 43 base64url characters, stored hashed on the
  Node, and bound to client device, Node, installation generation, contribution, context and
  grants. It expires after 15 minutes idle or eight hours absolute.
- **UI-VIEW-027:** Electron keeps the capability only in the native session broker's memory. It is
  write-only in protocol tooling and never enters URLs, logs, durable Client state, declarative
  documents, bespoke guest memory or plugin storage. Reopen issues a new capability.
- **UI-VIEW-003:** The initial document has monotonic `documentRevision = 1`, schema version,
  contribution root, declared data-source revisions and sensitivity/cache class.
- **UI-VIEW-004:** Default limits are 896 KiB encoded document bytes, 2,000 nodes, depth 32, 256
  bindings, 128 actions and 2,000 rows per collection page. The document limit leaves room for the
  authenticated `view.snapshot` envelope beneath the 1 MiB server-frame ceiling. Exceeding a limit
  returns a host-rendered bounded error and affects plugin health.

## Document model

A document is a rooted ordered tree of:

- component nodes: renderer kind/version, stable node ID, typed props, children;
- value nodes: typed scalar, resource reference, redacted secret status or structured closed value;
- bindings: named typed view state with initial value and validation;
- actions: named target plus input/result mappings and UX policy;
- data sources: declared query/subscription references and current revisions;
- localization: signed keys with default English message and parameter schema.

- **UI-VIEW-005:** Node IDs are unique within a document generation and stable across patches while
  the logical element remains. IDs are opaque to CSS and cannot encode authority.
- **UI-VIEW-006:** Bindings have type, bounds, owner (`node`, `client-session`, `form`,
  `selection`), sensitivity and reset behavior. Client bindings cannot become authoritative product
  state.
- **UI-VIEW-007:** Resource references include canonical ID, display projection, version and allowed
  navigation/action relations. Display labels are non-authoritative.
- **UI-VIEW-008:** Localization parameters are typed text/number/date values. Translation output is
  text, not markup. Missing locale falls back to signed default English.

## Patches

`ui-patch-v2` is a restricted JSON Patch batch. Operations are `test`, `add`, `replace`, and
`remove` over schema-approved paths beneath `title`, `accessibilityLabel`, or `root`. Move is
expressed as a tested remove/add in one atomic batch; subtree replacement, binding/action changes
and host-state changes use the same bounded operations.

- **UI-VIEW-009:** Each patch carries `apiVersion`, `documentId`, `fromRevision`, `toRevision` and
  operations. `toRevision` MUST equal `fromRevision + 1`; the authenticated stream/view-session
  context supplies session and generation.
- **UI-VIEW-010:** Electron applies a patch atomically only when session/generation/document and
  `fromRevision` match and the resulting document validates and stays within limits.
- **UI-VIEW-011:** A duplicate `(documentId,fromRevision,toRevision)` is acknowledged without
  reapplication. A revision gap, conflicting duplicate, failed `test`, invalid operation or unknown
  target requests a fresh authorized snapshot.
- **UI-VIEW-012:** A patch cannot change contribution identity, renderer requirements, action
  authority, host surface, cache/sensitivity class or session scope. Such changes require reopen.
- **UI-VIEW-013:** Maximum patch is 256 KiB and 256 operations. Node coalesces faster updates;
  Electron may apply backpressure and request snapshot when queue exceeds 2 MiB or 100 revisions.
- **UI-VIEW-014:** Focus and announcement are separate authenticated view-session messages, not
  patch operations. Focus is advisory and honored only if the session is visible, the user has not
  moved focus since the triggering action, and accessibility policy permits it.
- **UI-VIEW-015:** Announcements use host live-region policy, are rate-limited and cannot interrupt
  with arbitrary severity.

## User events and actions

- **UI-VIEW-016:** Electron sends only semantic user events defined by the selected renderer:
  action invoke, binding edit/commit/reset, selection change, page request, sort/filter change,
  disclosure, focus/visibility and measured viewport class.
- **UI-VIEW-017:** Events carry current view/document/action or binding revision and a schema-valid
  bounded payload. Raw DOM events, coordinates, keystrokes and clipboard content are not forwarded
  unless a renderer contract explicitly requires a user-gesture operation.
- **UI-VIEW-028:** The wire messages are the closed AsyncAPI families `view.event`,
  `view.patch.ack`, `view.snapshot.request`, `view.close`, `view.patch`, `view.snapshot`,
  `view.closed`, `view.focus` and `view.announcement`. Unknown view messages or fields are protocol
  errors; view capabilities are injected by the native session broker, never by declarative or
  bespoke content.
- **UI-VIEW-018:** The Node revalidates action availability, input, resource version and command
  authority. The view session proves context continuity only.
- **UI-VIEW-019:** One action invocation has a unique invocation ID. Double activation retrieves
  the stored outcome for keyed mutations rather than duplicating effects.
- **UI-VIEW-020:** Pending UI is host-rendered from action policy. Optimistic patches may change
  client presentation only and MUST include rollback/reconciliation behavior.

## Reconnect, suspend and close

- **UI-VIEW-021:** On transient disconnect, Electron freezes last authorized view, marks it stale,
  disables mutation and secret/native actions, and retains client-session bindings for at most the
  session grace period.
- **UI-VIEW-022:** Reconnect presents session and last applied revision. Node resumes only if
  identity, generation, context, grants and retention remain valid; otherwise it opens a new
  authorized snapshot and reapplies only compatible client presentation state.
- **UI-VIEW-023:** Hidden views send visibility state. Node may suspend expensive subscriptions;
  product events continue to the Node installation, not the hidden renderer.
- **UI-VIEW-024:** Close revokes session handles, cancels view-only queries, discards unsaved form
  secrets immediately, releases streams/native surfaces and records safe close reason.
- **UI-VIEW-025:** Node disable/quarantine, permission revocation, context change or generation
  update closes affected sessions immediately with a host reason.

## Conformance

- **UI-VIEW-026:** Tests MUST cover duplicate/gapped/out-of-order patches, invalid trees, limit
  exhaustion, action replay, stale resource versions, reconnect across generation change, revoked
  grants, capability replay, focus races, slow clients, closed-session events and secret-field
  disposal.
