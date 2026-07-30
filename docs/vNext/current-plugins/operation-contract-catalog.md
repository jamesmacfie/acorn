# Current-plugin operation contract catalog

**Status:** Normative<br>
**Requirement prefix:** `CUR-OP`

This catalog closes the operation-level contract for every V2 package in the current default
profile. It supplements each plugin specification; it does not replace its bounded input/result
fields, security rules, or parity scenarios. A manifest operation declaration MUST reference a
digest-pinned descriptor conforming to
[`plugin-operation-v2.schema.json`](../contracts/schema/plugin-operation-v2.schema.json).
The exact input/result fields and shared shape notation are in
[operation-payload-catalog.md](./operation-payload-catalog.md); neither document is optional.

`CUR-OP-000` The manifest set in `contracts/examples/current-plugin-manifests.yaml` is a
primary-contribution/artifact-class fixture, not a release manifest and not an operation inventory.
Release manifests MUST contain every operation in this catalog and the owning dossier, with the
exact generated descriptor and schema digests. Omitting an operation because it is absent from the
primary-contribution fixture is non-conforming.

## 1. Descriptor and schema rules

`CUR-OP-001` Every operation has an immutable descriptor and closed input/result JSON Schemas. The
schema URI is:

```text
https://acorn.dev/plugins/v2/<coordinate>/<kind>/<operation-slug>-<input|result>.schema.json
```

The manifest pins both schema digests. Schemas MUST state every field's type, bound, default,
nullability, sensitivity and resource-ancestry rule. Omission has no implicit meaning unless the
field schema defines a default. Unknown fields fail `validation_failed`.

`CUR-OP-002` The tables below are complete operation inventories. A package build fails semantic
conformance if its manifest declares an operation absent here, omits one present here, references
a different target or profile, lacks an event named here, or uses a schema whose field signature
contradicts the owning plugin document.

`CUR-OP-003` All Node operations authenticate a currently paired, non-revoked owner device over
TLS 1.3/mTLS, or a core-broker call carrying an authenticated delegated caller chain. Authorization
is evaluated at dispatch and again immediately before commit or external effect. Targets are
canonical `acorn://` URIs; the Node re-derives resource ancestry and rejects cross-Node IDs.

`CUR-OP-004` All commands accept `commandId`, `idempotencyKey`, `deadline`, `target`,
`expectedRevision` when the row/profile requires it, and a canonical input digest through the
shared command envelope. Queries accept `requestId`, `deadline`, `target`, pagination and
`snapshotSequence` where applicable. These envelope fields are defined once by the shared
protocol and MUST NOT be duplicated or weakened by plugin schemas.

## 2. Semantic profiles

Every row names one profile. A row-specific note or plugin rule may narrow a profile, never widen
it.

| Profile | Idempotency and concurrency | Cancellation and timeout | Commit point and resulting facts | Retry safety |
| --- | --- | --- | --- | --- |
| `Q-LOCAL` | fresh read; optional request dedup; observed resource/plugin/task generations | cancellable before result; 10 s default, 30 s max | no mutation/outbox; result carries snapshot sequence/freshness | automatic retry is safe after reauthorization |
| `Q-HEAVY` | fresh read; optional request dedup; observed generations | cancellable; 30 s default, 120 s max | no mutation/outbox; partial page/object refs are explicit | safe after reauthorization; discard partial response |
| `Q-EXTERNAL` | fresh provider/broker read; connection/provider generation | cancellable; 30 s default, 120 s max | provider response normalized; cache commit, if any, is atomic with invalidation event | retry only if no external mutation can occur |
| `M-LOCAL` | key required for 24 h; same key returns original; expected revision field-dependent | cancellable before transaction; 10 s default, 30 s max | owning plugin/core SQLite transaction and outbox commit together | same key returns result; conflict requires refresh |
| `M-LOCAL-DESTRUCTIVE` | natural or keyed idempotency for 24 h; expected revision required when resource exists | cancellable before delete commit; 30 s | tombstone/retention state and outbox commit together | same key/current tombstone is safe; no resurrection |
| `M-EPHEMERAL` | key or generation dedup; live resource/view/stream generation required | cancellable; 5 s default, 30 s max | lease/signal/queue acceptance, not durable product completion | never auto-repeat an ambiguous input/signal |
| `M-EXTERNAL` | key required for seven days; provider identity/current state reconciled | cancellable until provider acceptance; 60 s default, 120 s max | provider outcome then durable saga/mirror/outbox checkpoint | uncertain outcome is `completion_unknown`; reconcile first |
| `M-SAGA` | key required for seven days; immutable input and persisted step revisions | cancellable at declared safe edges; 120 s default, 1 h max | first durable intent is acceptance; terminal facts follow committed checkpoints | resume same saga; compensate only declared reversible steps |
| `M-EXECUTE` | key required for 24 h; task/checkout/config/grant generations | cancellation records durable intent; 120 s default, 1 h max | intent/checkpoint precedes process; result commits after known settlement | no duplicate execution after ambiguous outcome |
| `M-SECRET` | key required for 24 h; secret/config revision | cancellable before secret/provider commit; 5 min max | write-only secret reference plus connection/setup state and audit | never replay plaintext; resume using opaque operation |
| `C-LOCAL` | natural current-state behavior; no Node idempotency | local cancellation; 10 s max | Electron presentation state only; no product event | local action may be repeated |

`CUR-OP-005` Common errors for every Node operation are `unauthenticated`, `device_revoked`,
`permission_denied`, `not_found`, `wrong_node`, `validation_failed`, `plugin_unavailable`,
`plugin_quarantined`, `version_incompatible`, `cancelled`, `deadline_exceeded`, and
`internal_error`. Mutations additionally declare `idempotency_conflict`; revisioned rows declare
`conflict` or their named stale code; external/execute/saga rows declare `completion_unknown`,
`dependency_unavailable`, and `operation_failed`. Plugin documents add domain errors.

`CUR-OP-006` Event lists below name committed product facts. They are not synchronous responses or
authority. An empty event cell means the operation is read-only or ephemeral and MUST NOT emit a
durable product event. All facts use the owning namespace, safe payload projection, transactional
outbox and shared at-least-once replay semantics.

## 3. System plugins

### 3.1 Agents

Queries are exactly the ten `acorn.agents.*.v2` query rows in
[Agents contracts](./agents/contracts-events-and-security.md#query-catalog); their profiles are
`Q-HEAVY` for session search/snapshot/events, attachments/artifacts and webhooks, and `Q-LOCAL` for
provider/session/usage list or metadata reads.

| Command | Target | Profile | Expected revision | Commit/resulting events | Parity |
| --- | --- | --- | --- | --- | --- |
| `acorn.agents.session.create.v2` | task | `M-SAGA` | task generation | session intent; `session.created`, later state facts | Agent create |
| `acorn.agents.transcript.import.v2` | task | `M-SAGA` | task generation | imported ledger; `session.created` | import |
| `acorn.agents.import.verify-resume.v2` | session | `M-SAGA` | session | controller/config checkpoint; `session.updated` | resume import |
| `acorn.agents.attachment.upload.v2` | task | `M-SAGA` | task generation | verified object metadata; artifact fact when materialized | attachment |
| `acorn.agents.attachment.delete.v2` | attachment | `M-LOCAL-DESTRUCTIVE` | required | tombstone | attachment removal |
| `acorn.agents.turn.enqueue.v2` | session | `M-SAGA` | required | queued turn + `turn.queued` | prompt submit |
| `acorn.agents.turn.update-queued.v2` | turn | `M-LOCAL` | required | turn projection + `turn.updated` | queued edit |
| `acorn.agents.turn.cancel.v2` | turn | `M-EXECUTE` | required | cancellation intent; later status | cancel |
| `acorn.agents.request.resolve.v2` | request | `M-EXTERNAL` | required | resolving claim/outcome + `request.resolved` | approval |
| `acorn.agents.session.update.v2` | session | `M-LOCAL` | required | projection + `session.updated` | title/read/config |
| `acorn.agents.session.fork.v2` | session/turn | `M-SAGA` | required | lineage/new session + `session.created` | fork |
| `acorn.agents.session.compact.v2` | session | `M-SAGA` | required | operation/compaction checkpoint + state fact | compact |
| `acorn.agents.session.handoff-terminal.v2` | session | `M-SAGA` | required | controller lease + `controller-changed` | Terminal handoff |
| `acorn.agents.session.resume-managed.v2` | session | `M-SAGA` | required | controller lease + `controller-changed` | managed resume |
| `acorn.agents.session.archive.v2` | session | `M-LOCAL` | required | archive projection + `session.archived` | archive |
| `acorn.agents.session.delete.v2` | session | `M-SAGA` | required | tombstone/provider step + `session.deleted` | delete |
| `acorn.agents.session.export.v2` | session | `M-SAGA` | observed | export artifact + `artifact.created` | export |
| `acorn.agents.usage.refresh.v2` | node | `M-EPHEMERAL` | provider generation | safe refreshed result; no durable fact | usage refresh |
| `acorn.agents.pricing.update.v2` | node | `M-LOCAL` | required | settings/outbox; settings fact only | pricing |
| `acorn.agents.webhook.create.v2` | node/task | `M-SECRET` | Node grant | registration + webhook lifecycle fact | webhook create |
| `acorn.agents.webhook.update.v2` | webhook | `M-LOCAL` | required | registration + webhook lifecycle fact | webhook edit |
| `acorn.agents.webhook.delete.v2` | webhook | `M-LOCAL-DESTRUCTIVE` | required | revoke/tombstone + webhook lifecycle fact | webhook delete |

### 3.2 GitHub

The fourteen query rows in
[GitHub contracts](./github/contracts-events-and-security.md#query-catalog) are authoritative.
Mirror-only reads use `Q-LOCAL`, object/log/compare/batch reads use `Q-HEAVY`, and explicitly
provider-backed refresh is never hidden inside a query.

| Command group | Target | Profile | Revision | Commit/resulting events | Parity |
| --- | --- | --- | --- | --- | --- |
| `connection.create` | node | `M-SECRET` | Node trust | credential/connection saga; connection health | login |
| `connection.disconnect` | connection | `M-SAGA` | required | revoke/retain-or-purge; connection health | disconnect |
| `repositories.refresh`, `pulls.refresh-list`, `pull.refresh` | connection/repository/pull | `M-SAGA` | provider generation | atomic mirror batches; refreshed/changed facts | refresh |
| `pull.create` | repository | `M-EXTERNAL` | repository/head | provider PR plus mirror; pull created | create PR |
| `pull.merge` | pull | `M-EXTERNAL` | pull and optional head SHA | provider merge plus mirror; state changed | merge |
| `pull.auto-merge.set`, `pull.state.set`, `pull.draft.set` | pull | `M-EXTERNAL` | required | provider state plus mirror; state changed | PR controls |
| `pull.comment.create` | pull | `M-EXTERNAL` | pull/head as applicable | provider comment plus mirror; comment created | comment |
| `pull.label.add`, `pull.label.remove` | pull/label | `M-EXTERNAL` | pull | canonical label set; labels changed | labels |
| `pull.file-viewed.set` | pull/file | `M-LOCAL` | required | viewed projection/fact | viewed state |
| `review-comment.create`, `review-comment.reply` | pull/comment | `M-EXTERNAL` | head/comment | provider comment plus stale mirror; comment fact | inline review |
| `review-thread.resolved.set` | thread | `M-EXTERNAL` | required | provider state/stale mark; thread fact | thread resolve |
| `review.submit` | pull | `M-EXTERNAL` | pull/head | provider review/stale mark; review fact | submit review |
| `reviewer.add`, `reviewer.remove` | pull/reviewer | `M-EXTERNAL` | pull | provider/canonical set; reviewer fact | reviewers |
| `actions.rerun-failed` | actions run | `M-EXECUTE` | run attempt | external operation; action status facts | rerun |
| `repository.pin.set` | repository | `M-LOCAL` | required | pin/order state; repository preference fact | pin |

Each group expands to the exact fully-qualified `.v2` IDs in the owning catalog; grouping does not
create wildcard dispatch.

### 3.3 Terminal

The four Terminal queries use `Q-LOCAL`. The authenticated terminal byte protocol is a stream and
is not a command retry channel.

| Command | Target | Profile | Revision/generation | Commit/resulting events | Parity |
| --- | --- | --- | --- | --- | --- |
| `acorn.terminal.session.create.v2` | task | `M-EXECUTE` | task/checkout/profile | intent before PTY; `session.created`, state facts | new terminal |
| `acorn.terminal.session.interrupt.v2` | session | `M-EPHEMERAL` | controller/stream | signal outcome; no byte event | interrupt |
| `acorn.terminal.session.terminate.v2` | session | `M-EXECUTE` | controller/session | stopping checkpoint; state fact | kill |
| `acorn.terminal.session.remove.v2` | session | `M-LOCAL-DESTRUCTIVE` | session | tombstone + `session.removed` | close tab |
| `acorn.terminal.session.resize.v2` | session | `M-EPHEMERAL` | display generation | PTY dimensions only; no product fact | resize |
| `acorn.terminal.session.send.v2` | session | `M-EPHEMERAL` | controller/stream | sent/volatile queue result; no product fact | send |
| `acorn.terminal.session.attach-controller.v2` | session | `M-SAGA` | session/controller | lease relation + `controller-changed` | handoff |
| `acorn.terminal.session.release-controller.v2` | session | `M-SAGA` | session/controller | lease relation + `controller-changed` | release |
| `acorn.terminal.profile.setting-update.v2` | node | `M-LOCAL` | setting | setting/outbox; health fact if compatibility changes | settings |

## 4. Bundled Acorn Verified plugins

### 4.1 Changes

Queries `status.get`, `diff.get`, `blob.get`, and `notes.list` use `Q-LOCAL`, except blob/object
transfer uses `Q-HEAVY`.

| Command | Target | Profile | Revision | Resulting events |
| --- | --- | --- | --- | --- |
| `dev.acorn.changes.stage.v1`, `.unstage.v1` | task/path set | `M-EXECUTE` | checkout | `status.changed` |
| `dev.acorn.changes.discard.v1` | task/path set | `M-EXECUTE` | checkout | `status.changed` |
| `dev.acorn.changes.commit.v1`, `.push.v1` | task | `M-EXTERNAL` | checkout/head | `commit.created`, `push.completed|failed` |
| `dev.acorn.changes.note.create.v1` | task/diff anchor | `M-LOCAL` | diff/head | `note.created` |
| `dev.acorn.changes.note.edit.v1`, `.delete.v1` | note | `M-LOCAL` / `M-LOCAL-DESTRUCTIVE` | required | `note.edited|deleted` |
| `dev.acorn.changes.review.send.v1` | note revisions/session | `M-SAGA` | exact note revisions | `note.sent` only after enqueue |

### 4.2 Context

`inventory.get` uses `Q-HEAVY`. `snapshot.create` uses `M-SAGA` against exact section revisions and
commits the immutable Agents attachment plus `snapshot.created`. `send` uses `M-SAGA`, commits a
durable delivery operation, and emits `send.queued|delivered|failed`. Exported
`selection.capture` is `capability-query/Q-LOCAL`; it preserves the caller and task scope.

### 4.3 Database

Metadata/list/schema queries use `Q-LOCAL`; row pages use `Q-HEAVY`.

| Command | Target | Profile | Revision | Resulting events/retry |
| --- | --- | --- | --- | --- |
| `connection.open`, `connection.close` | task/lease | `M-EPHEMERAL` | config/task | `connection.opened|closed|failed`; do not replay |
| `sql.execute` | lease/task | `M-EXECUTE` | lease/schema digest | `query.completed|failed`; ambiguous execution is never retried |
| `row.insert`, `row.update`, `row.delete` | lease/table/row | `M-EXTERNAL` | PK plus xmin/version when available | `query.completed|failed`; zero rows is conflict |
| `saved.upsert`, `saved.delete` | saved query | `M-LOCAL` / `M-LOCAL-DESTRUCTIVE` | required on update/delete | `saved.created|updated|deleted` |
| `sql.generate` | task/schema digest | `M-SAGA` | schema and saved-query revisions | draft operation fact; execution is separate |

### 4.4 Docker

Inventory/inspect/list/task queries are `Q-EXTERNAL`; every result includes observed time and
live/stale/unavailable state.

| Command group | Target | Profile | Revision/trust | Resulting events |
| --- | --- | --- | --- | --- |
| `container.action`, `container.remove` | container | `M-EXECUTE` | daemon/container | command completed/failed, inventory changed |
| `image.remove`, `volume.remove`, `network.remove`, `prune` | exact Docker resource/scope | `M-EXECUTE` | daemon | command completed/failed, inventory changed |
| `compose.action` | task/materialized plan | `M-EXECUTE` | `composeSnapshotDigest` | command result, task match/inventory facts |
| `task.teardown` | task/materialized plan | `M-SAGA` | task/compose digest | itemized settlement; task-match facts |
| `logs.open`, `stats.open`, `exec.open` | container | `M-EPHEMERAL` | daemon/container/stream | stream lifecycle only; no content fact |

Destructive remove/prune/down actions require host confirmation. Logs/stats/exec use the declared
bounded stream protocol and never product-event their content.

### 4.5 Editor

The five Editor read/search contracts use `Q-LOCAL` or `Q-HEAVY` exactly as the owning catalog
states. `file.write`, `file.create`, and `directory.create` use `M-LOCAL`, require task/checkout
generation, require file revision for replacement, atomically mutate the filesystem before the
core file fact, and never automatically retry an ambiguous filesystem failure.

### 4.6 HTTP

List/get/result queries use `Q-LOCAL`.

| Command group | Target | Profile | Revision | Resulting events/retry |
| --- | --- | --- | --- | --- |
| `request.create`, `request.replace`, `request.delete` | request | `M-LOCAL` / destructive | required on replace/delete | request created/updated/deleted |
| `variable.create`, `variable.replace`, `variable.delete` | variable | `M-LOCAL` / destructive | required on replace/delete | variable created/updated/deleted |
| `send` | request/draft | `M-EXTERNAL` | request/draft/variable revisions | send accepted then completed/failed; reconcile same operation |
| `send.cancel` | send operation | `M-EPHEMERAL` | operation | cancelled fact when accepted |
| `curl.import` | workspace/task | `M-LOCAL` | destination collection | request created; imported secrets become write-only refs |

### 4.7 Memory

Reads and context/launch projections use `Q-LOCAL`; content search uses `Q-HEAVY`.

| Command | Target | Profile | Revision | Resulting events |
| --- | --- | --- | --- | --- |
| `entry.create` | repository/private scope | `M-LOCAL` | scope/index | `entry.created` |
| `proposal.create` | scope | `M-LOCAL` | source revision if promoted | `proposal.created` |
| `proposal.resolve` | proposal | `M-LOCAL` | required | accepted/rejected/flagged; accepted entry fact |
| `index.reconcile` | plugin installation | `M-SAGA` | storage generation | `index.reconciled|degraded` |
| `review.request` | task/session | `M-SAGA` | exact source revisions | `review.completed|skipped|failed` |

### 4.8 Notes

List/get/context queries use `Q-LOCAL`.

| Command | Target | Profile | Revision | Resulting events |
| --- | --- | --- | --- | --- |
| `note.create` | scope | `M-LOCAL` | scope | `note.created` |
| `note.replace`, `note.rename`, `note.set-included` | note | `M-LOCAL` | required | body-replaced/renamed/inclusion-changed |
| `note.append` | note | `M-LOCAL` | command-key serialization | `note.appended` |
| `note.delete` | note | `M-LOCAL-DESTRUCTIVE` | required | `note.deleted` |
| `scope.export-markdown` | scope | `M-SAGA` | snapshot sequence | `scope.exported`, artifact result |
| `scope.import-markdown` | scope | `M-SAGA` | scope revision | atomic import batch; `scope.imported` |

### 4.9 Onboarding

Status/import preview are `Q-LOCAL`. Workspace configure, import apply, and complete use `M-LOCAL`
with invariant/workspace revisions. Default-profile ensure uses `M-SAGA`; each package install is a
visible resumable child and completion occurs only after all required installations settle.
Reset-presentation is `C-LOCAL` and emits no Node event.

### 4.10 Preview

Configuration/rules reads are `Q-LOCAL`; target resolve is `Q-EXTERNAL`.

| Command | Target | Profile | Revision | Resulting events |
| --- | --- | --- | --- | --- |
| `acorn/preview.configuration.update@2` | plugin installation/node/workspace | `M-LOCAL` | required | `configuration.changed` |
| `acorn/preview.rules.upsert@2`, `.delete@2` | rule | `M-LOCAL` / destructive | required when existing | `rule.changed` |
| `acorn/preview.view.bind@2` | task/client/view | `M-SAGA` | target/view/client | short-lived lease; no browsing fact |
| `acorn/preview.view.unbind@2` | binding | `M-EPHEMERAL` | view generation | revoked lease; no browsing fact |

Browser snapshot/navigate/click/fill/screenshot/console calls are delegated capability commands
using `M-EPHEMERAL`, 30-second maximum, selected-client/view generation, no automatic retry, no
durable browsing event, and host refusal as an authoritative result.

### 4.11 Workflows

Definitions/runs/steps/handoff reads use `Q-LOCAL`; long histories use `Q-HEAVY`.

| Command | Target | Profile | Revision | Resulting events |
| --- | --- | --- | --- | --- |
| `definitions.rescan` | repository/workspace | `M-SAGA` | config snapshot | `definition.changed` |
| `runs.start` | task/definition | `M-SAGA` | definition/task/config | `run.started`, later status |
| `gates.resolve` | gate | `M-LOCAL` | gate/run/step required | `gate.resolved` |
| `runs.cancel`, `steps.kill` | run/step | `M-EXECUTE` | required | cancelling/status facts |
| `triggers.enable`, `triggers.disable` | trigger | `M-LOCAL` | required | trigger policy fact |
| `triggers.evaluate` | trigger | `M-SAGA` | trigger cursor/config | `trigger.evaluated`, optional run facts |

## 5. Marketplace integrations and executable profiles

### 5.1 Linear and Rollbar

Provider list/get/resolve operations use `Q-EXTERNAL` with bounded normalized results. Linear
`comment.create` uses `M-EXTERNAL`; `task.link` uses `M-LOCAL`; `task.promote` uses `M-SAGA`;
`connection.validate` uses `M-SECRET`. Rollbar `task.link` is `M-LOCAL`, `task.promote` is
`M-SAGA`, and `connection.validate` is `M-SECRET`. External ambiguous outcomes reconcile before
retry. Events are exactly those listed in each plugin's section 6 and contain safe summaries only.

### 5.2 Model Providers

Connections/catalog reads use `Q-LOCAL` or `Q-EXTERNAL` as freshness requires.
`generate` is `M-EXTERNAL`, cancellable before provider settlement, never automatically repeated
after ambiguity, and emits only redacted usage. Connection validate/test use `M-SECRET`; plaintext
credentials are write-only wizard inputs and are never replayed.

### 5.3 Aider, Claude and Codex profiles

Descriptor/availability/compatibility queries use `Q-LOCAL`. Interactive launch uses
`M-EXECUTE` delegated to Terminal. Headless run and resume use `M-EXECUTE` delegated to the owning
Agents/Workflows operation. Task-scoped MCP registration uses `M-EPHEMERAL` and expires with the
operation. Profile availability/compatibility are the only profile-owned durable events; bytes,
prompts, output and raw provider frames stay in the owning authenticated stream.

## 6. Conformance and parity gate

`CUR-OP-100` Build conformance expands every grouped row into one exact descriptor, validates it
against `plugin-operation-v2.schema.json`, validates input/result examples against their pinned
schemas, and checks that manifest contributions/capability exports/events reference only declared
operation IDs.

`CUR-OP-101` Negative fixtures MUST reject a missing target, unqualified resource, absent
idempotency policy, unsafe automatic external retry, mutation without commit point, event absent
from the manifest, a destructive action without confirmation, a delegated call that drops caller
identity, and a schema that permits unknown fields.

`CUR-OP-102` Every operation row maps to the exact visible scenario in its current-plugin parity
section. The parity runner records operation ID, target Node, input-schema digest, command ID,
resulting events, final snapshot and screenshot/accessibility evidence. A visual success backed by
an undeclared/private route fails.

`CUR-OP-103` The V2 implementation MUST contain no generic plugin RPC escape hatch. A plugin cannot
invoke a string method absent from its manifest operation descriptors, and System plugins use the
same broker validation as Community plugins except for their explicitly enumerated in-process
runtime authority.
