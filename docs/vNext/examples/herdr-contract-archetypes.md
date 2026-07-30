# Herdr contract archetypes and expansion ledger

**Status:** Normative compatibility closure<br>
**Requirement prefix:** `HERDR-ARC`

This document turns the concise top-100 assessment into deterministic Acorn package contracts.
It is read together with the exact
[source snapshot and rows](./herdr-top-100-compatibility-matrix.md). The source row remains
authoritative for repository, commit, observed version, surfaces, authority, state, dependencies
and fit. This document supplies the repeated operation, event, worker, UI, lifecycle and build
semantics omitted from the row for readability.

The expanded normative result is
[`herdr-top-100-fixtures.json`](../contracts/examples/herdr-top-100-fixtures.json), validated by
[`herdr-fixture-set-v2.schema.json`](../contracts/schema/herdr-fixture-set-v2.schema.json). It
contains explicit empty arrays rather than omitted surface families and preserves raw source
commands/regexes only as inert evidence, never executable Acorn declarations.

## 1. Deterministic expansion

`HERDR-ARC-001` A compatibility fixture coordinate uses the fixed assessment publisher
`community-herdr` and the following deterministic package algorithm:

1. canonical source key is the UTF-8 bytes of lowercased GitHub `owner/repository`;
2. compute SHA-256 over that exact key and encode all 32 bytes as unpadded RFC 4648 base32,
   lowercased (52 characters);
3. normalize the key with Unicode NFKC, lowercase it, replace runs outside `[a-z0-9]` with `-`,
   trim hyphens, take the first six characters, trim any hyphens exposed at the end by that
   truncation, and use `plugin` if empty; and
4. emit `p-<slug>-<base32-digest>`, shortening only the slug when necessary to keep the package at
   63 characters.

The `p-` prefix guarantees a letter-leading, non-reserved package for digit-leading owners. The
full digest makes length overflow deterministic and removes slug collisions. The registry stores
the canonical source key beside the coordinate and MUST reject digest collision, source-key
rebinding or any later normalization algorithm changing an existing identity. This is an
assessment coordinate, not a claim on a production publisher namespace.

`HERDR-ARC-002` Stable identifiers are constructed without guesswork:

- manifest action `<id>` becomes
  `community-herdr.<package>.command.<normalized-id>.v1`;
- pane `<id>` becomes contribution
  `<normalized-id>-pane` and view `<normalized-id>-view`;
- consumed event `<type>` becomes subscription `<normalized-type>-subscription`;
- link handler ordinal `n` becomes `link-handler-<n>` with the exact inspected pattern in its
  fixture;
- startup ordinal `n` becomes `startup-reconciler-<n>`;
- build ordinal `n` becomes output `build-output-<n>`; and
- a name collision receives the stable suffix `-<manifest-relative-path-digest-first-eight>`.

Normalization is lowercase NFKC, replaces every run outside `[a-z0-9]` with `-`, trims hyphens and
fails if the result is empty. It never silently renames a reserved Acorn identifier.

`HERDR-ARC-003` Each action expands to one contribution and one
[`plugin-operation-v2`](../contracts/schema/plugin-operation-v2.schema.json) descriptor. An
inspection fixture MUST state the action's input fields; where the source accepts free-form argv or
shell, the Acorn port replaces it with a closed enum/field schema or becomes Verified fixed-tool
execution. Arbitrary shell strings are never inferred. The materialized fixture carries the exact
closed input and result schema documents, their canonical SHA-256 digests and their operation/role
bindings; a schema reference that does not resolve uniquely in that registry is invalid. Active
resource identity, idempotency and concurrency metadata belong to the broker command envelope and
therefore are not duplicated in an action payload unless the action itself declares such a field.
An empty input object is exact—not a placeholder—only when the inspected Herdr manifest exposes a
fixed action with no user-supplied parameter and the active node-qualified resource is the command
target. Pane queries return `{viewSession, documentRevision, snapshotSequence}` and transfer their
semantic document through the bounded view-session protocol. Stream commands return
`{status, operation, stream}`; other successful Node commands return `{status, operation}` and use
the shared terminal-failure union for errors. Client-only presentation commands return
`{status, presentationRevision}` and have no Node capability. The fixture schema and validator
enforce those four result families.

`HERDR-ARC-003A` Operation kind follows effect, not a verb in the source action ID. A `status`,
`validate` or `list` action that launches a CLI, refreshes a provider or starts a broker call is a
command under `CON-QUERY-001`, even if its eventual domain result is read-only. A focus/tab/pane
action that only changes the current Electron presentation is a capability-free `client-command`.
The recent-navigator fixture applies that split explicitly; no presentation-only action receives
Workspace, Task or worktree authority.

`HERDR-ARC-004` Every pane expands to a closed
[`contribution-v2`](../contracts/schema/contribution-v2.schema.json) task/shell/Fleet contribution,
renderer requirements and an explicit desktop/mobile fallback. `overlay`, `popup`, `split`,
`zoomed` and `tab` are placement preferences; Electron remains free to satisfy accessibility,
minimum size and focus rules with an equivalent host layout.

`HERDR-ARC-005` Consumed Node facts require a declared dependency or core event grant, a resource
filter, persisted inbox cursor, `(nodeId,eventId)` deduplication, snapshot query and replay-gap
recovery. Source focus/layout events instead use the bounded `client-presentation` contract and
never enter the Node outbox; renderer interactions stay inside their mounted view. Source events
do not carry authority. A port may publish only manifest-declared, versioned events within its own
coordinate.

`HERDR-ARC-006` Every `W` worker uses
[`worker-v2.schema.json`](../contracts/schema/worker-v2.schema.json). Pollers map to scheduled
workers, event reactors to event-driven workers, and daemons/gateways/supervisors to resident
workers. Every worker has finite concurrency, checkpoint schema, start/readiness/heartbeat/drain/
stop deadlines, restart window, exponential backoff, resource ceilings and quarantine policy.

`HERDR-ARC-007` A source `S` startup entry is not arbitrary launch authority. It becomes a
restart-safe desired-state reconciliation call with a persisted checkpoint. It MUST be idempotent,
bounded, cancellable, dependency-ordered and incapable of widening grants.

`HERDR-ARC-008` Every `B` entry records exactly one machine disposition: `published-artifact`,
`validated-source-plan`, `developer-author-plan-required`, `unsupported`, or `extension`. A
published artifact records its immutable digest and provenance. A validated plan uses
[`source-build-plan-v2`](../contracts/schema/source-build-plan-v2.schema.json) pinned to the row's
exact commit and tree digest. The isolated builder has no credentials/network/install-script
authority; every dependency is pre-acquired and digest-pinned. Two builds MUST produce identical
output digests. `developer-author-plan-required` records the commit, a null plan/digest, and
`awaiting-author-plan`; Acorn does not infer a build from source strings and MUST NOT acquire or
activate artifacts until an author supplies and passes a schema-valid reproducible plan. `B0`
records `not-applicable`.

`HERDR-ARC-009` All state is installation-private SQLite/blob storage. “No state” permits only
bounded disposable cache. Streams use authenticated credit, sequence, cancellation and byte
ceilings. Credentials are opaque refs used by purpose/destination-bound brokers. Cross-plugin calls
preserve delegated caller identity and require declared dependencies.

`HERDR-ARC-010` All supported archetypes inherit coordinated Node/client installation, explicit
permission/setup state, health-gated atomic activation, generation-pinned handles, drain, rollback,
quarantine, disclosed uninstall retention and identity-compatible reinstall. Partial acquisition
remains visible and resumable.

## 2. Complete archetype contracts

Abbreviations: `D` declarative UI, `WASI` Community component, `VN` Acorn Verified sandboxed native
helper, `EN` Electron-native host capability, `SW` scheduled worker, `EW` event worker, `RW`
resident worker, `DB` private plugin SQLite, and `OBJ` plugin object/blob allocation. Every UI row
also requires standard loading, empty, stale, denied, unsupported and error states.

| ID | Runtime and contributions | Operations, events, worker and storage | Authority, dependencies, renderer/fallback |
| --- | --- | --- | --- |
| `ARC-01` | `WASI` + optional `VN`; command, wizard, task pane | lease/job query; warm/start/cancel/reconcile commands; job facts; log/artifact stream; `RW`; `DB+OBJ` | task/repo read, fixed process, destination network/secret; log/timeline/detail; mobile status/actions |
| `ARC-02` | `D+WASI`; file task pane and commands | tree/file/search/diff queries; reveal/refresh; file/core events; object stream; cache only | task file/Git read; file-tree/code/Markdown/search/diff; mobile read-only detail |
| `ARC-03` | `D+WASI`; review pane, commands, navigation | status/diff/comments; draft/send actions; worktree/PR facts; diff/object stream; `DB` drafts | task file/Git, optional GitHub/Agents capabilities; diff/detail/form; mobile summary/approve only |
| `ARC-04` | Node companion + `EN`; browser pane, link handler | target/bind/browser actions; ephemeral view/tunnel protocols; `RW`; session metadata only | Preview/browser capability, selected Client and constrained network; browser-preview + declarative fallback; `HERDR-EXT-002` where driving is required |
| `ARC-05` | `D+WASI`; workspace utilities, picker/overlay, command/keybinding/wizard | workspace/task query; exact utility commands; worktree/task facts; progress; optional `EW`; preferences/history | workspace/task/repo/Git and fixed process only per action; list/form/progress; mobile compact actions |
| `ARC-06` | `WASI RW`; Fleet source, attention, notification, approval, wizard | Agent status/approval queries/actions; Agent subscriptions; opaque future relay; cursor/config `DB` | Agents read/events/approve, brokered network/secret/notification; Fleet/attention; desktop works, mobile/relay is `HERDR-EXT-001` |
| `ARC-07` | no plugin runtime; core Fleet navigation | pair/list/focus Node resources; core Node events/cache | paired Node mTLS only; core Fleet renderers; SSH shadowing rejected by `HERDR-DEC-002` |
| `ARC-08` | `D+WASI`; command/keybinding/picker/navigation | bounded source query and typed host action; no custom event unless declared; preferences | task/workspace/UI/clipboard per exact action; list/form/navigation; mobile semantic picker |
| `ARC-09` | `WASI` Verified provider adapter; settings/wizard/badge/dashboard | provider validate/health/usage; health/usage facts; optional `SW`; accounting `DB` | provider broker, secret, usage, selected Agent events; metrics/detail; transform requires `HERDR-EXT-004` |
| `ARC-10` | `D+WASI` plus optional `VN` OS helper; command/settings/badge/title | settings/query/action; selected events; no daemon by default; preferences | presentation metadata and narrow OS capability; status/form; outer title requires `HERDR-EXT-003` |
| `ARC-11` | Electron title contribution only | client-local refresh/template; no Node event/storage | read-only presentation projection; accessible static fallback; `HERDR-EXT-003` |
| `ARC-12` | `VN`; fixed TUI in Terminal pane/overlay, command/keybinding | launch/focus/stop; PTY stream; process facts; supervised process metadata | Verified fixed executable, task cwd, Terminal/display-process; terminal/log; mobile status/manual instruction |
| `ARC-13` | `WASI`; settings/wizard/test, notification/attention/navigation | validate/test; selected Agent event subscription; dedupe cursor/config `DB` | brokered destination/secret + notification; form/attention; mobile notification only under future client |
| `ARC-14` | `D+WASI` + optional `VN`; command/wizard/board/approvals/timeline | work-item CRUD/dispatch/cancel; Agent/Terminal/task facts; progress; `EW/RW`; journal `DB` | Agents, Terminal, task/worktree/Git, fixed process as declared; board/timeline/form; mobile queue/approval |
| `ARC-15` | `WASI`; orchestrator command/wizard/progress | inspect/plan/apply/recover; repository commands trust-gated; `SW` if scheduled; journal `DB` | task/repo/config trust, fixed process; wizard/log/progress; mobile plan/status only |
| `ARC-16` | `D+WASI`; badge/detail/action/navigation | status query/action; scoped event subscription; cache/preferences | read-only core/plugin dependency plus exact action grant; status/detail; mobile badge/detail |
| `ARC-17` | `VN`; editor navigation/status/health | launch/focus/health/enable; process health facts; supervised process state | Verified editor executable and file intents; status/navigation; mobile unsupported/manual instruction |
| `ARC-18` | `D+WASI SW`; Fleet/task metrics and notifications | sample/query/reset; metric facts; time-series `DB` | selected redacted events or metrics broker; charts/table/status; mobile compact metric |
| `ARC-19` | `D+WASI` or signed bespoke UI; Fleet/task table/board/timeline/attention | roster/status/actions; Agent/Terminal events; `EW/RW`; discovery/cache `DB` | Agents/Terminal/task read and explicit mutation grants; table/board/timeline; semantic mobile fallback |
| `ARC-20` | no plugin runtime; core marketplace surface | marketplace query and owner install/update/remove commands | core-only lifecycle authority; core catalog renderer; plugin installer rejected by `HERDR-DEC-001` |
| `ARC-21` | `D+WASI SW`; badge/rate-limit/detail/wizard/notice | quota/status/refresh; provider events; quota cache `DB` | provider metadata/network/secret as needed; badge/detail/form; mobile status |
| `ARC-22` | `D+WASI SW`; settings/wizard/dashboard/health/test | poll/query/test/reset; health facts; samples/config `DB` | destination-bound network/secret; charts/detail; mobile compact health |
| `ARC-23` | `D+WASI` + `VN` OS metrics; badge/slot/dashboard/settings | sample/query; metric facts; `SW`; time-series `DB` | Verified OS-metric read only; charts/badge; mobile summary |
| `ARC-24` | `D+WASI`; settings/save/restore/preview wizard/progress | snapshot/preview/restore; participating export/import capabilities; artifact stream; `SW`; encrypted `OBJ` index | workspace/task/Terminal/Agents snapshot and declared plugin capabilities; wizard/detail; mobile preview/status |
| `ARC-25` | `D+WASI` + `EN`; settings/navigation/pane | target query/open/close; ephemeral browser protocol; optional `RW`; config only | browser-preview and constrained network; preview + semantic fallback; driving is `HERDR-EXT-002` |
| `ARC-26` | `D+WASI SW`; settings/wizard/command/history/health | scheduled job CRUD/run/cancel/history; schedule/job facts; run journal `DB` | exact fixed process/network/secret grants; list/timeline/log; mobile status/run |
| `ARC-27` | `D+WASI`; provider adapter workspace source/pane/table/detail/settings/actions | provider list/get/action/validate; provider facts; optional `SW`; normalized cache `DB` | brokered provider/network/secret; collection/detail/form; mobile list/detail/action |
| `ARC-28` | `D+WASI EW`; workspace/task badge/Git status/settings | status/reconcile; Git/task events; checkpoint/cache `DB` | repository metadata/Git read; badge/detail; mobile badge |
| `ARC-29` | `D+WASI` supervisor + `VN` SSH/tmux; pane/command/setup/rollback/log | connect/start/stop/rollback/status; connection facts; `RW`; lease/journal `DB` | Verified fixed SSH/tmux, destination-bound secret/network, task; terminal/log/wizard; mobile status/manual |
| `ARC-30` | `D+WASI EW`; diagnostics/agent status/custom wake/external scoreboard | diagnose/wake/status; Agent/custom facts; `EW`; cursor/config `DB` | selected Agent events and destination network; status/timeline; mobile status |
| `ARC-31` | no runtime; marketplace catalog/search content | core catalog ingest/query only | public metadata; core catalog UI; repository is not a plugin by `HERDR-DEC-003` |
| `ARC-32` | `D+WASI` + packaged `VN` fixed executable; pane/list/table/Kanban/commands | issue/task CRUD/sync; resource facts; optional `SW`; `DB` | task/repo/file plus fixed `bd` executable; list/table/board; mobile list/detail |
| `ARC-33` | `D+WASI SW`; indexer/search/stats/report/settings/reindex | index/query/reindex; index facts; `SW`; FTS `DB` | approved file/repo read; search/list/detail; mobile search summary |
| `ARC-34` | `D+WASI RW`; arm/stop/status/health/log/attention | arm/stop/query; supervisor facts; `RW`; journal `DB` | exact process/Agent/notification grants; log/status/attention; mobile stop/status |
| `ARC-35` | `D+WASI`; task pane Kanban/list/detail/tab-link navigation | item query/CRUD/move/focus; item facts; `DB` | task/workspace and typed navigation; board/list/detail; mobile list/detail |

`HERDR-ARC-011` `ARC-20`, `ARC-31` and `ARC-07` describe core product dispositions, not installable
manifest fixtures. `ARC-06`, browser-driving cases of `ARC-04/25`, `ARC-09` transforms and
`ARC-10/11` titles remain explicitly named extensions where the top-100 row says Extension. An
archetype never changes a row's Supported/Extension/Unsupported fit.

## 3. Top-100 expansion ledger

The mapping is total and single-valued. Row-specific counts, action names, pane placement, event
names, source build count, worker evidence, authority and fit override the archetype defaults.

| Rows | Archetype |
| --- | --- |
| `HERDR-001`, `024` | `ARC-01` |
| `HERDR-002`, `028`, `059`, `081` | `ARC-02` |
| `HERDR-003`, `010`, `037`, `045`, `047`, `088`, `099` | `ARC-03` |
| `HERDR-004`, `058` | `ARC-04` |
| `HERDR-005`, `009`, `012`–`014`, `018`, `019`, `022`, `023`, `035`, `039`, `046`, `060`, `062`, `063`, `065`, `066`, `078`, `086` | `ARC-05` |
| `HERDR-006`, `007`, `025` | `ARC-06` |
| `HERDR-008` | `ARC-07` |
| `HERDR-011`, `015`, `016`, `029`, `073`, `080`, `087` | `ARC-08` |
| `HERDR-017` | `ARC-09` |
| `HERDR-020`, `040`, `064`, `082`, `096` | `ARC-10` |
| `HERDR-021` | `ARC-11` |
| `HERDR-026`, `043`, `048`, `075`, `094` | `ARC-12` |
| `HERDR-027`, `054`, `056`, `069`, `070`, `079`, `100` | `ARC-13` |
| `HERDR-030`, `033`, `044`, `050`, `053`, `072`, `090` | `ARC-14` |
| `HERDR-031`, `097` | `ARC-15` |
| `HERDR-032` | `ARC-16` |
| `HERDR-034` | `ARC-17` |
| `HERDR-036` | `ARC-18` |
| `HERDR-038`, `052`, `084`, `085`, `091`, `092` | `ARC-19` |
| `HERDR-041`, `077` | `ARC-20` |
| `HERDR-042` | `ARC-21` |
| `HERDR-049` | `ARC-22` |
| `HERDR-051` | `ARC-23` |
| `HERDR-055` | `ARC-24` |
| `HERDR-057` | `ARC-25` |
| `HERDR-061` | `ARC-26` |
| `HERDR-067`, `068` | `ARC-27` |
| `HERDR-071` | `ARC-28` |
| `HERDR-074` | `ARC-29` |
| `HERDR-076` | `ARC-30` |
| `HERDR-083` | `ARC-31` |
| `HERDR-089` | `ARC-32` |
| `HERDR-093` | `ARC-33` |
| `HERDR-095` | `ARC-34` |
| `HERDR-098` | `ARC-35` |

`HERDR-ARC-012` The ledger contains every integer 001–100 exactly once. Conformance expands each
row with its archetype, generates the deterministic manifest/contribution/operation/worker/build
fixtures, and validates them against the pinned schemas. For Unsupported rows the expected fixture
is a closed product-decision record, not an executable manifest. For Extension rows validation
must additionally prove that V2 activation stays unavailable until the named extension capability
is negotiated.

## 4. Source-event disposition

The generated row records preserve every source event occurrence, including duplicate
platform-specific handlers, and assign exactly one of these dispositions. `node-fact` entries
receive the durable replay/snapshot contract. `client-presentation` entries receive the local
device epoch/sequence and bounded slice contract. No source name is blindly forwarded.

| Herdr source event | Acorn disposition | Exact Acorn input |
| --- | --- | --- |
| `pane.agent_detected` | `node-fact` | `acorn.agents.session.detected.v2` |
| `pane.agent_status_changed` | `node-fact` | `acorn.agents.session.status-changed.v2` |
| `pane.exited` | `node-fact` | `acorn.terminal.session.exited.v2` |
| `workspace.created` | `node-fact` | `acorn.core.workspace.created.v2` |
| `workspace.closed` | `node-fact` | `acorn.core.workspace.archived.v2` |
| `workspace.renamed` | `node-fact` | `acorn.core.workspace.renamed.v2` |
| `workspace.updated` | `node-fact` | `acorn.core.workspace.updated.v2` |
| `worktree.created` | `node-fact` | `acorn.core.worktree.created.v2` |
| `worktree.opened` | `node-fact` | `acorn.core.worktree.opened.v2` |
| `worktree.removed` | `node-fact` | `acorn.core.worktree.removed.v2` |
| `workspace.focused` | `client-presentation` | `workspace-focused` |
| `workspace.moved` | `client-presentation` | `layout-changed` |
| `tab.created` | `client-presentation` | `pane-opened` |
| `tab.closed` | `client-presentation` | `pane-closed` |
| `tab.focused` | `client-presentation` | `pane-focused` |
| `tab.moved` | `client-presentation` | `pane-moved` |
| `tab.renamed` | `client-presentation` | `layout-changed` |
| `pane.created` | `client-presentation` | `pane-opened` |
| `pane.closed` | `client-presentation` | `pane-closed` |
| `pane.focused` | `client-presentation` | `pane-focused` |
| `pane.moved` | `client-presentation` | `pane-moved` |

`HERDR-ARC-013` A row that consumes both classes declares separate Node subscriptions and one
`client-presentation` contribution. Client state is installation-private, local to one Electron
device, capped at 256 entries/1 MiB, and cleared on uninstall. Client restart creates a new epoch
and supplies current focus/layout before later events. It is not backed up, synchronized,
published, or made available to a background Node worker.

`HERDR-ARC-014` For the 19 affected rows (`HERDR-008`, `019`, `021`, `028`, `032`, `033`, `034`,
`039`, `040`, `042`, `049`, `054`, `055`, `061`, `065`, `075`, `076`, `082`, `096`), the
machine fixture lists each occurrence in `clientEvents` or `nodeEvents`. An operation requiring a
local presentation reaction runs as a host reducer/client command. If a behavior also needs a Node
mutation, that client command invokes the ordinary separately authorized Node command; the local
event itself supplies no authority.

## 5. Link, key, theme, build and bespoke dispositions

`HERDR-ARC-015` Every source link record retains its exact inspected regex as inert evidence and
contains one or more safe Acorn navigation templates. The regex is never executed. The ten source
handlers in rows `004`, `010`, `024`, `033`, `037` (two), `058`, `059` (two), and `088` resolve
to declared resource, route or client-command destinations. The machine fixture is authoritative
for the translated templates and capture mappings.

`HERDR-ARC-016` Source build disposition is exact: entries in behaviorally representable rows are
`developer-author-plan-required` with source commit, manifest-relative ordinal, null tree
digest/plan and activation `awaiting-author-plan`; entries in Unsupported rows are `unsupported`
and `blocked-product-decision`. `B0` rows are `not-applicable`. All three sets total the 59 entries
in 53 build-bearing repositories. This corpus contains no Acorn-published immutable artifact and
the review did not author repository-specific reproducible plans; therefore no build is inferred
or run. This does not change behavioral fit—Supported means Acorn can represent the port—but every
Developer Source installation remains visibly blocked until its author supplies a valid plan.

`HERDR-ARC-017` Legacy command keys translate as follows and are subject to host conflict/reserved
chord policy: `HERDR-019` `prefix+shift+l` invokes `apply`; `HERDR-036` `prefix+$` invokes
`open-dashboard`; `HERDR-090` `prefix+r` invokes `second-opinion` and `prefix+shift+r` invokes
`resume-last`; `HERDR-093` `prefix+d`, `prefix+s`, and `prefix+t` invoke `sd-stats`,
`sd-fuzzy-search`, and `sd-trend`. The generated keybinding contributions use task/workspace scope
and never override an existing binding.

`HERDR-ARC-018` `HERDR-065`'s Tab/Shift-Tab/arrows/C-p/C-n/Enter/Escape/C-c/Backspace bindings are
standard keyboard semantics inside its collection/search renderer, not global Electron commands.
The renderer supplies roving focus, screen-reader announcements, visible focus, remappable
alternatives and non-keyboard activation; mobile uses touch selection/back. Its source `dark`
theme becomes `respect-client-semantic-theme`, not a plugin global theme contribution.

`HERDR-ARC-019` Bespoke presentation in `HERDR-038`, `052`, `084`, `085`, `091`, and `092` is an
optional desktop enhancement only. Their semantic table/board/timeline implementations contain
all status, recovery and critical actions, so installation and mobile behavior do not depend on
bespoke UI. If a publisher later supplies the enhancement it MUST declare a schema-valid
`bespokeViews[]` host/bridge object and the semantic contribution remains its mandatory fallback.

## 6. Adversarial and semantic conformance

`HERDR-ARC-020` Positive fixtures MUST cover all 28 contribution kinds, all 35 archetypes, all
observed pane placements, all ten link declarations, all seven startup entries, all legacy/current
keybinding forms after normalized translation, all 59 build entries and each `SW/EW/RW` class.

`HERDR-ARC-021` Negative fixtures MUST reject an undeclared action, event, link target, startup
hook, worker schedule, renderer, dependency, capability, network host, secret purpose, native
binary, build output or custom event schema.

`HERDR-ARC-022` A Community package that needs arbitrary native execution does not become
“Supported” by porting the manifest alone. It either replaces execution with WASI/brokered fixed
operations, obtains Acorn Verified provenance and an enforceable native sandbox, or fails
installation with a named incompatibility.

`HERDR-ARC-023` Link handlers map only validated input to a typed navigation intent. They cannot
open arbitrary schemes, execute commands, obtain network access, bypass target ancestry or smuggle
data into an Electron origin. Literal network templates may use a bounded `{name:port}` capture;
manifest-owned non-network schemes may use the authorityless `scheme:/path` form. Thus the frozen
localhost handlers retain arbitrary validated ports and `report:/absolute/path` remains
representable without evaluating the source regular expression.

`HERDR-ARC-024` Background workers cannot self-install, persist an undeclared daemon, inherit
credentials/environment, listen on an arbitrary interface, spawn an unbounded process tree, or
survive disable/revocation. Startup reconciliation cannot invoke a worker from another installation.

`HERDR-ARC-025` The compatibility assertion passes only when all 100 expansions validate, all four
Unsupported rows match their deliberate decisions, all seven Extension rows fail closed without
their named extension, and every remaining row has a safe representation with no private API,
cross-plugin SQL, raw JavaScript injection or ambient authority.

`HERDR-ARC-026` The materialized fixture set is generated from the frozen 416-record marketplace
snapshot, exact 100-repository commit ledger and 101 parsed manifests. Release validation MUST
reproduce 100 unique ordered coordinates, 294 actions, 108 panes, 130 event entries, seven startup
entries, ten link handlers, 59 build entries, 35 worker-bearing repositories and the 89/7/4 fit
arithmetic. Every manifest command target and worker operation MUST resolve to a row operation;
every keybinding MUST resolve to a row contribution.

`HERDR-ARC-027` A row manifest requests exactly the set union of capabilities referenced by its
materialized operations plus the event-subscription capability required by its declared Node-event
subscriptions. Every operation carries only the grants needed for that action or worker. Client-only
presentation actions use `client-command` and no Node grant. Release validation MUST reject an
unreferenced requested grant, an operation grant absent from the manifest, a schema reference that
does not resolve to exactly one same-operation/same-role document, a digest mismatch after canonical
JSON serialization, a document whose `$id` differs from its registry URI, or a required field not
present in the document's `properties`.

`HERDR-ARC-028` The frozen expansion materializes 449 operations: 310 Node commands, 105 queries
and 34 client commands. Its 898 closed operation-schema documents bind one input and one result
schema to every operation. Each of the 105 installable task panes names one unique declared query
contribution as `dataQuery`; Unsupported rows do not acquire executable pane contracts. Every one
of the 42 declared streams is attached to at least one operation and every referenced stream is
declared exactly once in the same row.

`HERDR-ARC-029` The 51 materialized workers comprise one scheduled worker, 31 event-driven workers
and 19 resident workers. Every installable row consuming a durable Node fact has an admitted,
checkpointed event consumer. `HERDR-039` requests event subscription only; `HERDR-019` layout
application remains client-local while validation and stale-worktree removal receive separate
least-authority operations. `HERDR-061` is the scheduled-worker witness. `HERDR-076` is the custom
event witness: it declares one namespaced, versioned, digest-pinned payload schema, requests publish
authority, identifies its producer, and commits the event through the transactional outbox.
