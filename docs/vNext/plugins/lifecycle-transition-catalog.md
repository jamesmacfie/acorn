# Plugin lifecycle transition catalog

Status: **Normative**<br>
Requirement prefix: `PLUG-TRANS`

This is the exhaustive edge catalog for the installation aggregate. An edge not listed here returns
`invalid_lifecycle_transition`. Every command input is closed
`{apiVersion:"acorn.dev/plugin-lifecycle-command/v2",commandId,installationId|null,coordinate,
expectedLifecycleRevision,operation,requestedVersion|null,reason|null}`; IDs are UUIDv7, coordinate
is publisher/name, revision is unsigned decimal, version is SemVer and reason is 1–300 safe
characters. Result is closed `{apiVersion:"acorn.dev/plugin-lifecycle-result/v2",commandId,
operationUri,installationId,lifecycleRevision,state,resumeTarget|null}`. Authentication is the mTLS
device; it is never accepted from the body.

Every edge below persists the command, initiating device/system actor, old/new state, selected and
candidate generation, phase, safe reason, deadline, cancellation state, recovery command,
correlation and lifecycle revision. The transition row and its named event are appended in the same
core transaction. `plugin.lifecycle.transitioned.v2` is always emitted in addition to the named
event and carries only installation URI, old/new state, phase, generations, actor, safe reason,
operation URI and recovery command.

## Shared edge rules

- **PLUG-TRANS-001:** `owner` means a paired full-owner device; `system` may initiate only security
  quarantine, health rollback or restart reconciliation. Permission, unrestricted code, secret,
  destructive and recovery ceremonies still require trusted host UI and OS presence where stated.
- **PLUG-TRANS-002:** Short transitions time out in 30 seconds, acquisition/migration/start in five
  minutes, setup at its persisted wizard expiry, drain in the manifest's lower bounded deadline.
  Timeout before commit retains the prior authoritative generation and enters the row's restart/
  failure state. Cancellation is accepted only where the row says `yes`.
- **PLUG-TRANS-003:** `switch` is one transaction updating selected generation/lock/contributions,
  superseding grants for the old generation, revoking old handles and emitting the event. External
  download/build/process/migration work is never the commit point.
- **PLUG-TRANS-004:** Restart resumes a named idempotent phase from its journal, or restores the
  prior selected generation and records `failed(resumeTarget)`; it never advances merely because a
  file/process exists. User result always shows current state, completed phases, retained data/
  artifacts, safe failure and the exact recovery command.
- **PLUG-TRANS-005:** Audit for every row includes command/request, actor/delegation, installation/
  coordinate, old/new lifecycle revision and state, old/new generation, artifact/manifest digests,
  permission-request/grant versions when relevant, reason/outcome and recovery command; it excludes
  secrets, paths, package bytes, logs and wizard answers.

## Exhaustive transitions

Columns `persist/effect`, `cancel/deadline`, `commit/event`, `restart`, `UX/recovery`, and `audit`
are the ten transition obligations together with command/actor and precondition. `standard` audit
means `PLUG-TRANS-005`.

| ID | Edge | Command; actor | Preconditions | Persist/effect | Cancel/deadline | Commit; success/failure event | Restart | UX/recovery | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PLUG-TRANS-010` | absent→resolving | `plugin.install.request.v2`; owner | no retained install; coordinate/source policy valid | create installation+operation; resolver phase | yes/30s | installation row; `plugin.install.requested.v2` / `plugin.install.failed.v2` | resume resolver | Resolving; cancel/retry | standard |
| `PLUG-TRANS-011` | resolving→awaiting_artifact | `plugin.install.resume.v2`; owner/system-resume | exact dependency solution and lock | persist lock/candidate generation | yes/5m | lock digest; `plugin.artifact.resolution_completed.v2` / failed | reacquire exact lock | Downloading; retry/cancel | standard+lock |
| `PLUG-TRANS-012` | resolving→failed | internal phase failure; system | terminal solver error | safe failure+`resumeTarget=resolving` | no/instant | failure row; `plugin.install.failed.v2` | stable failed | Resolve failed; retry/uninstall | standard |
| `PLUG-TRANS-013` | awaiting_artifact→verifying | `plugin.install.resume.v2`; owner/system-resume | every required Node/client digest acquired or acknowledged partial | content-store refs and client acknowledgements | yes/5m | acquisition journal; `plugin.artifact.acquired.v2` / failed | reacquire missing digest | Verifying; retry/cancel | standard+client ack |
| `PLUG-TRANS-014` | awaiting_artifact→cancelled | `plugin.install.cancel.v2`; owner | activation not committed | remove temporary bytes; preserve policy data | yes/30s | cancelled row; `plugin.install.cancelled.v2` / failed | finish cleanup | Cancelled; resume/purge | standard |
| `PLUG-TRANS-015` | awaiting_artifact→failed | internal phase failure; system | terminal acquisition error | failure+`resumeTarget=awaiting_artifact` | no/instant | failure; `plugin.install.failed.v2` | stable failed | Download failed; retry/cancel | standard |
| `PLUG-TRANS-016` | verifying→awaiting_permission | `plugin.install.resume.v2`; owner/system-resume | all artifacts/signatures/provenance/archive/platform valid | verification evidence and permission request digest | yes/5m | evidence commit; `plugin.artifact.verified.v2` / failed | reverify bytes | Review permissions; retry/cancel | standard+provenance |
| `PLUG-TRANS-017` | verifying→failed | internal verification denial; system | signature/policy/archive failure | quarantine bad bytes; failure+resume verify or none | no/instant | failure; `plugin.install.failed.v2` | stable failed | Verification failed; remove/retry metadata | standard+failure class |
| `PLUG-TRANS-018` | awaiting_permission→staging | `plugin.permission.decide.v2`; owner | all required requests granted for candidate generation | closed grants and decision audit | no/30s | grant transaction; `plugin.permissions.changed.v2` / failed | remain awaiting on incomplete commit | Staging; review grants | standard+grant IDs |
| `PLUG-TRANS-019` | awaiting_permission→cancelled | `plugin.install.cancel.v2`; owner | activation not committed | cancel request; revoke candidate grants | yes/30s | cancelled; `plugin.install.cancelled.v2` / failed | finish revoke | Cancelled; resume/purge | standard |
| `PLUG-TRANS-020` | awaiting_permission→failed | internal policy failure; system | request/schema/policy irrecoverable | failure+`resumeTarget=awaiting_permission` | no/instant | failure; `plugin.install.failed.v2` | stable failed | Policy failed; re-resolve/uninstall | standard |
| `PLUG-TRANS-021` | staging→awaiting_setup | `plugin.install.resume.v2`; owner/system-resume | immutable roots/storage prepared; required setup | staged generation and wizard instance | yes/5m | stage journal; `plugin.install.staged.v2` / failed | verify stage then resume | Setup required; resume/cancel | standard |
| `PLUG-TRANS-022` | staging→activating | `plugin.install.resume.v2`; owner/system-resume | stage complete; setup not required/already compatible | migration/start plan | yes/5m | activation intent; `plugin.activation.started.v2` / failed | resume activation pre-switch | Activating; retry/cancel pre-switch | standard |
| `PLUG-TRANS-023` | staging→failed | internal stage failure; system | unpack/quota/storage failure | delete incomplete root; retain immutable artifact | no/instant | failure; `plugin.install.failed.v2` | cleanup then failed | Stage failed; retry/export | standard |
| `PLUG-TRANS-024` | awaiting_setup→activating | `plugin.setup.complete.v2`; owner | wizard completed; settings/secrets validate | setup effects journal+activation plan | no/5m | setup completion; `plugin.setup.completed.v2` / failed | compensate/resume exact step | Activating; retry setup | standard+effect IDs |
| `PLUG-TRANS-025` | awaiting_setup→cancelled | `plugin.install.cancel.v2`; owner | no activation switch | cancel wizard; retain/delete data per choice | yes/30s | cancelled; `plugin.setup.cancelled.v2` / failed | resume cleanup | Setup cancelled; resume/remove | standard |
| `PLUG-TRANS-026` | awaiting_setup→failed | internal setup failure; system | terminal step/compensation failure | failure+`resumeTarget=awaiting_setup` | no/instant | failure; `plugin.setup.failed.v2` | stable failed | Setup failed; resume/export/remove | standard |
| `PLUG-TRANS-027` | activating→active | `plugin.activation.commit.v2`; owner/system-resume | migrations done; runtime/client contributions ready; grants current | `switch`; rollback snapshot retained | no/5m | atomic switch; `plugin.activated.v2` / activation failed | selected generation is truth | Installed/Updated; open/manage | standard+health gates |
| `PLUG-TRANS-028` | activating→rolling_back | `plugin.rollback.start.v2`; system health/owner | pre/post-switch health failed and compatible prior snapshot exists | rollback operation; drain candidate | no/5m | rollback intent; `plugin.rollback.started.v2` / failed | resume rollback | Rolling back; diagnostics | standard |
| `PLUG-TRANS-029` | activating→failed | internal activation failure; system | no safe automatic rollback | stop candidate; prior selected remains or none | no/instant | failure; `plugin.activation.failed.v2` | stable failed | Activation failed; retry/rollback/uninstall | standard |
| `PLUG-TRANS-030` | active→updating | `plugin.update.start.v2`; owner | update metadata/compatibility available; expected revision | candidate operation; old stays selected | yes/30s | update intent; `plugin.update.started.v2` / failed | resume candidate work | Updating; cancel | standard |
| `PLUG-TRANS-031` | active→disabled | `plugin.disable.v2`; owner | no lifecycle lease; confirmation | drain and revoke contributions/handles | no/drain | selected-disabled flag; `plugin.disabled.v2` / failed | enforce disabled then stop | Disabled; enable/uninstall | standard |
| `PLUG-TRANS-032` | active→quarantined | `plugin.quarantine.v2`; system security/owner | security/health policy trigger | immediate admission stop, revoke, evidence snapshot | no/instant | quarantine flag; `plugin.quarantined.v2` / incident failure | enforce quarantine first | Quarantined; inspect/remediate/uninstall | standard+incident |
| `PLUG-TRANS-033` | active→uninstalling | `plugin.uninstall.v2`; owner | retention choice and dependency impact confirmed | uninstall journal; drain | no/drain | uninstall intent; `plugin.uninstall.started.v2` / failed | resume drain/removal | Uninstalling; diagnostics | standard |
| `PLUG-TRANS-034` | updating→active | `plugin.update.cancel.v2`; owner/system failure | switch not committed | delete candidate temporary state; old unchanged | yes/30s | candidate cancellation; `plugin.update.cancelled.v2` / failed | retain old active | Update cancelled; retry | standard |
| `PLUG-TRANS-035` | updating→activating | `plugin.update.activate.v2`; owner/system-resume | candidate acquired/verified/granted/setup/migrated/ready | activation intent | no/5m | intent; `plugin.activation.started.v2` / failed | resume pre-switch | Activating update; diagnostics | standard |
| `PLUG-TRANS-036` | updating→rolling_back | `plugin.rollback.start.v2`; owner/system | update touched staged data/effects requiring restore | rollback plan+compensations | no/5m | intent; `plugin.rollback.started.v2` / failed | resume rollback | Reverting update; diagnostics | standard |
| `PLUG-TRANS-037` | updating→failed | internal update failure; system | old cannot safely remain marked updating | candidate stopped; old selected; resume target updating | no/instant | failure; `plugin.update.failed.v2` | stable failed with old serving only when recorded | Update failed; resume/cancel | standard |
| `PLUG-TRANS-038` | rolling_back→active | `plugin.rollback.commit.v2`; owner/system-resume | prior generation/data/dependencies ready and policy-valid | `switch` to prior; drain failed candidate | no/5m | atomic switch; `plugin.rolled_back.v2` / failed | selected prior is truth | Rolled back; manage | standard |
| `PLUG-TRANS-039` | rolling_back→disabled | `plugin.rollback.disable.v2`; owner/system | no safely activatable prior | preserve generations/data; stop all | no/5m | disabled flag; `plugin.rollback.failed_disabled.v2` / failed | enforce disabled | Rollback incomplete; retry/export/uninstall | standard |
| `PLUG-TRANS-040` | rolling_back→failed | internal rollback failure; system | recovery itself interrupted/invalid | failure+resumeTarget=rolling_back; no mixed routing | no/instant | failure; `plugin.rollback.failed.v2` | stable failed | Rollback failed; retry/disable | standard |
| `PLUG-TRANS-041` | disabled→activating | `plugin.enable.v2`; owner | selected artifact/policy/grants/setup compatible | start/readiness plan | no/5m | activation intent; `plugin.activation.started.v2` / failed | resume or remain disabled | Enabling; retry | standard |
| `PLUG-TRANS-042` | disabled→uninstalling | `plugin.uninstall.v2`; owner | dependency/retention confirmed | uninstall journal | no/drain | intent; `plugin.uninstall.started.v2` / failed | resume uninstall | Uninstalling | standard |
| `PLUG-TRANS-043` | disabled→quarantined | `plugin.quarantine.v2`; system/owner | integrity/policy incident | evidence+quarantine flag | no/instant | quarantine; `plugin.quarantined.v2` / failure | enforce quarantine | Quarantined | standard+incident |
| `PLUG-TRANS-044` | quarantined→disabled | `plugin.quarantine.acknowledge.v2`; owner+OS presence | incident contained; no activation approval | retain evidence; mark disabled | no/30s | state switch; `plugin.quarantine.cleared_disabled.v2` / failed | remain quarantined unless committed | Disabled after quarantine; inspect/enable | standard+closure |
| `PLUG-TRANS-045` | quarantined→activating | `plugin.quarantine.remediate.v2`; owner+OS presence | artifact replaced/reverified, grants reviewed, conformance health pass | new generation only; old remains sealed | no/5m | activation intent; `plugin.activation.started.v2` / failed | quarantine until safe commit | Remediating; retry/uninstall | standard+remediation |
| `PLUG-TRANS-046` | quarantined→uninstalling | `plugin.uninstall.v2`; owner | evidence retention and data choice confirmed | uninstall without executing plugin | no/5m | intent; `plugin.uninstall.started.v2` / failed | resume host-only removal | Removing quarantined plugin | standard |
| `PLUG-TRANS-047` | uninstalling→retained | host phase; system | runtime stopped; code/contributions removed; retain data chosen | sealed plugin data+expiry | no/5m | removal commit; `plugin.uninstalled.v2` / failed | finish host removal | Removed; data retained, reinstall/purge | standard |
| `PLUG-TRANS-048` | uninstalling→absent | host phase; system | runtime stopped; purge-now chosen; data/keys deletable | remove code/data/grants/refs | no/5m | deletion commit; `plugin.uninstalled.v2` / failed | resume deletion journal | Removed; reinstall | standard |
| `PLUG-TRANS-049` | uninstalling→failed | internal uninstall failure; system | host cleanup failed | safe residual inventory+resumeTarget=uninstalling | no/instant | failure; `plugin.uninstall.failed.v2` | stable failed | Removal incomplete; retry/export | standard |
| `PLUG-TRANS-050` | retained→resolving | `plugin.reinstall.v2`; owner | exact retained coordinate/data policy shown | new install operation linked to retained data | yes/30s | resolver start; `plugin.reinstall.started.v2` / failed | resume resolver | Reinstalling; cancel | standard |
| `PLUG-TRANS-051` | retained→purging | `plugin.data.purge.v2`; owner+OS presence | retention/dependency/backup warning confirmed | purge journal; crypto-erasure first | no/5m | purge intent; `plugin.data.purge_started.v2` / failed | resume purge | Purging; cannot undo | standard |
| `PLUG-TRANS-052` | purging→absent | host phase; system | DB/files/keys/object refs deleted or accurately residual | tombstone only | no/5m | purge commit; `plugin.data.purged.v2` / failed | finish journal | Data purged; reinstall | standard |
| `PLUG-TRANS-053` | purging→failed | internal purge failure; system | residual deletion failure | exact residuals+resumeTarget=purging | no/instant | failure; `plugin.data.purge_failed.v2` | stable failed | Purge incomplete; retry | standard |
| `PLUG-TRANS-054` | cancelled→resolving | `plugin.install.resume.v2`; owner | source/lock policy still valid | new operation revision; reuse verified immutable bytes | yes/30s | resolver start; `plugin.install.requested.v2` / failed | resume resolver | Resuming install | standard |
| `PLUG-TRANS-055` | cancelled→purging | `plugin.data.purge.v2`; owner | retained setup/data exists | purge journal | no/5m | purge intent; `plugin.data.purge_started.v2` / failed | resume purge | Purging cancelled data | standard |
| `PLUG-TRANS-056` | cancelled→absent | `plugin.install.discard.v2`; owner | no retained durable data/effects | delete operation/temp record | no/30s | deletion; `plugin.install.discarded.v2` / failed | finish deletion | Install discarded | standard |
| `PLUG-TRANS-057` | failed→resumeTarget | recovery command stored in failure; owner/system-resume | expected revision; cause/remediation preconditions satisfied | new operation linked to failure | command-specific | CAS to exact recorded target; `plugin.lifecycle.resumed.v2` / failed | target rule | Resuming named phase | standard+prior failure |
| `PLUG-TRANS-058` | failed→uninstalling | `plugin.uninstall.v2`; owner | residual inventory and retention choice confirmed | host-only uninstall journal | no/5m | intent; `plugin.uninstall.started.v2` / failed | resume uninstall | Removing failed plugin | standard |

## Coordinated Client acquisition

- **PLUG-TRANS-060:** Required Client artifacts have per-device states `not_requested → acquiring →
  verified → acknowledged`, with `acquiring|verified → failed|cancelled` and
  `failed|cancelled → acquiring`. `plugin.client-artifact.acquire.v2` is core-issued only to the
  initiating authenticated Client; `acknowledge.v2` carries installation/candidate generation,
  platform/architecture, artifact digest and local verification evidence digest. Node persists each
  acknowledgement before `PLUG-TRANS-027`.
- **PLUG-TRANS-061:** Another compatible paired Client may resume acquisition but cannot assert a
  different digest or satisfy the initiating Client's acknowledgement. A disconnected Client leaves
  visible `awaiting_client_artifact`; install Resume on that Client or Continue without optional
  contribution are explicit recovery commands. A required artifact never silently disappears.

## Model acceptance

- **PLUG-TRANS-062:** The model fixture is the table above: tests instantiate every row with minimum,
  maximum and stale revision, crash before/after persisted effect and commit, cancel/timeout, restart
  and recovery. They generate the cartesian state graph and assert that every edge absent from
  `PLUG-TRANS-010` through `PLUG-TRANS-058` fails `invalid_lifecycle_transition`.
