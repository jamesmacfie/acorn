# Plugin parity and Herdr adversarial review

**Status:** Historical adversarial findings with closure re-review completed<br>
**Review date:** 2026-07-30<br>
**Reviewer:** Plugin, parity, and Herdr review track<br>
**Requirement prefix:** `REVIEW-PPH`<br>
**Finding prefix:** `REVIEW-PPH`

## Current verdict

The original ten findings are retained below as the audit trail. Closure re-review on 2026-07-31
verified the contribution schema, renderer registry, worker/runtime contracts, exhaustive lifecycle
transition catalog, first-party runtime choices, source-build plan, V1 surface ledger, parity
shortcut and materialized Herdr corpus.

`REVIEW-PPH-004` is closed by the complete current-plugin operation inventory, semantic profiles,
the exact payload field catalog and release-schema conformance rules. `REVIEW-PPH-008` is closed by
the 100-row fixture set with 449 descriptors, 898 digest-bound schemas, four semantic result
families, client-only focus actions without Node authority, worker/build/event/stream bindings and
canonical validation. No Critical, High or Medium finding remains open.

## Initial verdict (historical)

The current-plugin inventory and Herdr source research are substantial and, where independently
checkable, accurate. All twenty current plugins are present, the six complex plugin specifications
have the required five-file shape, the other fourteen use the required twelve-section template,
the twenty-five baselined cross-feature imports have named replacement boundaries, and the Herdr
matrix contains exactly one hundred correctly ordered and evidenced repositories.

The specification is nevertheless **blocked from completion** by eight High findings. The main
failure is contract closure: several plugin behaviors that prose and the Herdr matrix call
supported cannot be represented by the normative manifest, renderer, runtime, command, lifecycle,
or source-build contracts without an implementer choosing new fields or semantics. Two Medium
parity findings also require correction or an accepted-risk decision.

No Critical finding was identified in this review. High findings block `ACCEPT-MIG-060`.

## Scope and method

This review compared:

- all files under `docs/vNext/current-plugins/` against the current plugin source, composition
  roots, route registries, database schema, contribution registries, tests, and shipped product
  documentation;
- `docs/vNext/migration/coupling-and-extraction-map.md` against the literal shrinking baseline in
  `apps/desktop/src/core/boundaries.test.ts`;
- the desktop parity contract against the current pane, source, settings, command, shortcut,
  terminal, Agent, GitHub review, and task-layout implementations;
- all one hundred Herdr rows against the captured 2026-07-30 marketplace snapshot, the inspected
  commit ledger, parsed manifests, and repository archives;
- each claimed Acorn representation against the normative plugin manifest schema, WIT world,
  contribution catalog, renderer catalog, lifecycle rules, installation rules, security model,
  examples, and current-plugin contracts; and
- adversarial plugin designs covering terminal panes, agent status, worktrees, actions,
  keybindings, link handlers, startup hooks, daemons, source builds, credentials, notifications,
  cross-plugin invocation, supervised workers, custom events, native processes, installers,
  directly reachable remote Nodes, future relay transport, and future mobile clients.

This review did not rewrite specification content. Required changes appear only as finding closure
criteria.

## Current-plugin coverage

“Complete shape” means that a simple plugin contains all twelve mandatory sections, or that a
complex plugin's five files collectively cover those sections. “Cross-cutting blockers” references
findings that prevent the otherwise complete plugin document from becoming an executable package
contract.

| Plugin | Required shape | Locked classification found | V1 surface and state coverage | Review result |
| --- | --- | --- | --- | --- |
| Agents | five-file complex | System | Agent Center, task pane/sidebar, attention, notifications, usage, sessions/turns/requests/events/artifacts/webhooks | Complete shape; blocked by `REVIEW-PPH-002`, `-004`, and `-005` |
| GitHub | five-file complex | System | source, classic browser, PR task pane, create flow, checks panel, mirror tables/blobs, review lifecycle | Complete shape; blocked by `REVIEW-PPH-002`, `-004`, and `-005` |
| Terminal | five-file complex | System | drawer, sessions/profiles, PTY/tmux, streams, run targets, status, settings | Complete shape; blocked by `REVIEW-PPH-004`, `-005`, and parity finding `-009` |
| Editor | five-file complex | Acorn Verified, default | editor/search panes, file tree, Monaco behavior, save/reload/reveal, renderer-provider ownership | Complete shape; blocked by `REVIEW-PPH-001`, `-002`, and `-004` |
| Preview | five-file complex | Acorn Verified, default | task preview pane, Node target resolution, Electron browser host, archive/reconnect behavior | Complete shape; blocked by `REVIEW-PPH-001`, `-002`, and `-004` |
| Workflows | five-file complex | Acorn Verified, default | definitions, settings, scheduler, runs/steps, activity, gates, recovery | Complete shape; blocked by `REVIEW-PPH-001`, `-003`, `-004`, and `-005` |
| Changes | twelve sections | Acorn Verified, default | local diff, Git actions, review notes, agent handoff, dirty refresh | Complete shape; blocked by `REVIEW-PPH-002`, `-004`, and `-006` |
| Context | twelve sections | Acorn Verified, default | section aggregation, inclusion/budget, preview/sync, Notes/Memory boundaries | Complete shape; blocked by `REVIEW-PPH-001` and `-004` |
| Database | twelve sections | Acorn Verified, default | connection, schema/grid/editor, row mutations, saved queries, SQL generation | Complete shape; blocked by `REVIEW-PPH-002`, `-004`, and `-006` |
| Docker | twelve sections | Acorn Verified, default | source/pane/badges, matching, actions, logs/stats/exec, archive concern | Complete shape; blocked by `REVIEW-PPH-003`, `-004`, and `-006` |
| HTTP | twelve sections | Acorn Verified, default | source/pane, requests/variables/auth, command variables, send/result UI | Complete shape; blocked by `REVIEW-PPH-001` and `-004` |
| Memory | twelve sections | Acorn Verified, default | accepted memory, proposals, index/search, context contribution, promotion | Complete shape; blocked by `REVIEW-PPH-001` and `-004` |
| Notes | twelve sections | Acorn Verified, default | scoped library/editor, inclusion, autosave, own service/storage/events | Complete shape; blocked by `REVIEW-PPH-002` and `-004` |
| Onboarding | twelve sections | Acorn Verified, default | first-run modal replacement, workspace setup/import decision, resumable wizard | Complete shape; blocked by `REVIEW-PPH-001`, `-004`, and `-005` |
| Linear | twelve sections | Acorn Verified marketplace reference, default dormant | source/task target, provider detail, comments, promotion, reference detection | Complete shape; blocked by `REVIEW-PPH-001` and `-004` |
| Rollbar | twelve sections | Acorn Verified marketplace reference, default dormant | source/task target, projects/items/detail, promotion, privacy normalization | Complete shape; blocked by `REVIEW-PPH-001` and `-004` |
| Model Providers | twelve sections | Acorn Verified marketplace reference, default dormant | provider settings/setup, brokered generation, model catalogs, normalized usage/errors | Complete shape; blocked by `REVIEW-PPH-004` |
| Aider profile | twelve sections | Verified executable profile, default | discovery, PTY launch, task scope, missing executable, terminal handoff | Complete shape; blocked by `REVIEW-PPH-001` and `-004` |
| Claude profile | twelve sections | Verified executable profile, default | discovery, interactive/headless/resume, stream adapter, setup/failure | Complete shape; blocked by `REVIEW-PPH-001` and `-004` |
| Codex profile | twelve sections | Verified executable profile, default | discovery, interactive/headless/resume, app-server stream/MCP behavior | Complete shape; blocked by `REVIEW-PPH-001` and `-004` |

### Plugin inventory checks that passed

- `REVIEW-PPH-PASS-001`: The inventory contains exactly twenty target plugins and no current V1
  plugin is omitted.
- `REVIEW-PPH-PASS-002`: GitHub, Terminal, and Agents are consistently classified as System and
  made non-uninstallable.
- `REVIEW-PPH-PASS-003`: Changes, Context, Database, Docker, Editor, HTTP, Memory, Notes,
  Onboarding, Preview, and Workflows are independently packaged Acorn Verified default-profile
  plugins.
- `REVIEW-PPH-PASS-004`: Linear, Rollbar, and Model Providers are Acorn Verified marketplace
  references installed dormant in the default profile; Aider, Claude, and Codex are executable
  profile examples included in that profile.
- `REVIEW-PPH-PASS-005`: The six complex folders—Agents, Editor, GitHub, Preview, Terminal, and
  Workflows—each contain `README.md`, `node-and-data.md`, `client-and-ui.md`,
  `contracts-events-and-security.md`, and `migration-and-parity.md`.
- `REVIEW-PPH-PASS-006`: Each of the remaining fourteen plugin files contains the twelve required
  sections in order.
- `REVIEW-PPH-PASS-007`: The current central SQLite owners are reassigned rather than copied
  wholesale into V2 core. GitHub mirror state, review notes, saved SQL, HTTP definitions, Terminal
  sessions, Agents history, Workflows runs, provider issues, Notes, and Memory all receive explicit
  target owners and clean-start treatment.
- `REVIEW-PPH-PASS-008`: The requested ownership corrections are present: Editor owns the standard
  editor/file/search/diff renderer providers; Changes consumes the standard diff renderer; Preview
  splits Node target resolution from Electron browser hosting; Terminal relinquishes generic
  process/worktree/file/Git/config-trust primitives; GitHub does not own Acorn identity or Linear
  UI; Notes owns its service; Context uses typed knowledge contributions; and Workflows owns its
  client contract.

## Coupling review

The source baseline contains exactly twelve core-to-plugin edges and thirteen plugin-to-plugin
edges. The migration map contains the same twenty-five edges:

- all seven `App.tsx` edges to GitHub, Onboarding, and Terminal;
- all three Command Palette edges to Agents/Terminal;
- both `TaskView` edges to Terminal;
- Agents sidebar to Terminal;
- both Changes-to-GitHub diff edges;
- both Context-to-knowledge implementation edges;
- Database-to-Monaco;
- all three GitHub-to-Linear edges;
- Memory-to-Notes;
- Notes-to-Context;
- Preview-to-Terminal; and
- Workflows-to-Agents.

Each edge has a named renderer, contribution, capability, event, or ownership correction.
`MIG-020` requires the target count to become zero and `MIG-028` prevents dynamic loading while an
unbrokered edge remains.

- `REVIEW-PPH-PASS-009`: The twenty-five-row inventory is complete and matches the executable V1
  baseline.
- `REVIEW-PPH-PASS-010`: No replacement preserves direct cross-plugin SQL, shared mutable objects,
  private endpoint calls, or implementation imports.
- `REVIEW-PPH-PASS-011`: Notes/Memory/Context and GitHub/Linear replacements preserve dependency
  direction and avoid required dependency cycles.

The replacement concepts pass. Their machine representation is blocked by
`REVIEW-PPH-001` and their per-operation completeness by `REVIEW-PPH-004`.

## Herdr evidence verification

The external snapshot portion passed independent structural and arithmetic checks:

- `REVIEW-PPH-PASS-012`: The matrix has exactly one hundred rows, numbered `HERDR-001` through
  `HERDR-100` without a gap or duplicate.
- `REVIEW-PPH-PASS-013`: Sorting the captured 416-record marketplace array by stars descending and
  `pushedAt` descending produces the same one hundred repositories in the same order. Each matrix
  star value matches the captured snapshot.
- `REVIEW-PPH-PASS-014`: Every row has repository, exact forty-character commit link, source-tree
  link, observed product version or explicit no-product-version statement, access date inherited
  from the method, and manifest evidence or explicit manifest absence.
- `REVIEW-PPH-PASS-015`: All one hundred row commit hashes match the independent repository
  acquisition ledger. All declared product versions match parsed manifests, including the two
  dual-manifest repositories. The manifest-free directory row is explicitly identified.
- `REVIEW-PPH-PASS-016`: Every row's `A`, `P`, `E`, `S`, `L`, and `B` counts match its parsed
  repository manifests after the matrix's documented repository-level de-duplication.
- `REVIEW-PPH-PASS-017`: Aggregate counts reproduce exactly: 101 manifests; 90 repositories with
  actions, 66 with panes, 41 with events, 53 with builds, eight with link handlers, six with
  startup hooks, four with legacy key blocks, one with a keybindings block, and one with a theme.
  Entry totals are 294 actions, 108 panes, 130 events, 59 builds, ten link handlers, and seven
  startup entries.
- `REVIEW-PPH-PASS-018`: The fit count is exactly 89 Supported, seven Extension, and four
  Unsupported. The seven Extension rows point to `HERDR-EXT-001` through `-004`; the four
  Unsupported rows point to `HERDR-DEC-001` through `-003`.
- `REVIEW-PPH-PASS-019`: The twenty-five-question rubric covers core surface, UI, operations,
  consumed/published events, replay, capabilities, delegation, dependencies, workers, streams,
  storage, files, credentials, network, renderer/fallback, runtime, trust, installation, update,
  removal, and observability.
- `REVIEW-PPH-PASS-020`: Installer and plugin-manager replacements are deliberately unsupported
  through a named product decision; SSH shadow workspaces are rejected in favor of paired Nodes;
  mobile/relay, browser control, window title, and provider transforms are named extensions rather
  than silently claimed as V2 deliverables.

These checks establish that the **observed Herdr corpus is accurately recorded**. They do not
establish that every target representation is implementable; findings `REVIEW-PPH-001`,
`-002`, `-003`, `-004`, `-007`, and `-008` block that stronger assertion.

## Adversarial escape matrix

| Escape design | Result | Evidence and required boundary |
| --- | --- | --- |
| Terminal pane wrapping a fixed TUI | Partially represented | Terminal renderer, PTY stream, task cwd, and Verified fixed-tool policy exist; fixed executable/argument contribution encoding is incomplete under `REVIEW-PPH-001` |
| Fleet agent-status monitor | Represented | Agents snapshot/events, attention, badges, notifications, Node-qualified navigation, and replay recovery are defined |
| Worktree/session manager | Represented | Core workspace/task/worktree capabilities, sagas, progress facts, and task-pane/wizard surfaces prevent a plugin from owning generic worktree primitives |
| Action palette with contextual actions | Partially represented | Commands and predicates are conceptually defined; manifest command contribution omits required scope/input/repeatability fields under `REVIEW-PPH-001` |
| Global/workspace/task/pane keybindings | Partially represented | Conflict and reserved-key policy exists; manifest keybindings have no declared scope under `REVIEW-PPH-001` |
| URL/link handler with regex dispatch | Not representable as declared | The catalog requires target patterns/resource mapping, but the manifest's `navigation-intent` shape contains only command, title, and confirmation; see `REVIEW-PPH-001` |
| Startup reconciler | Not implementation-ready | Desired-state semantics exist in prose; worker activation and full scheduler fields are missing from machine contracts; see `REVIEW-PPH-003` |
| Long-running daemon | Not implementation-ready | Supervision policy exists, but the WASI world has no background-service or timer contract; see `REVIEW-PPH-003` |
| Source-built plugin | Not implementation-ready | Exact commit and isolated build policy exist, but no machine build-plan/install input exists; see `REVIEW-PPH-007` |
| Credentialed provider integration | Represented | Write-only secret references, purpose/destination-bound broker injection, redaction, rotation, and audit are defined |
| Notification bridge | Partially represented | Host notice/attention policy exists; the manifest omits deduplication, privacy, expiry, toast, target, and action fields under `REVIEW-PPH-001` |
| Cross-plugin synchronous invocation | Represented at architecture level | Declared dependency and capability export, caller-chain preservation, delegated-authority intersection, and no ambient credentials are defined |
| Cross-plugin event consumer | Represented at architecture level | Declared dependency/event permission, durable inbox/outbox, replay, duplicate handling, and namespace rules are defined |
| Plugin-defined custom events | Represented at runtime level | Namespaced publication, schema references, transaction-buffered event drafts, redaction, and replay are defined; per-plugin declarations remain incomplete under `REVIEW-PPH-004` and `-008` |
| Supervised scheduled worker | Not implementation-ready | Poller prose names overlap/backoff/deadline requirements that the manifest and WIT cannot encode; see `REVIEW-PPH-003` |
| Verified native process | Represented | Exact signed executable, mandatory OS sandbox, brokered IPC, process-tree supervision, fail-closed unsupported platforms, quarantine, and Developer Source contrast are defined |
| Unsandboxed native plugin | Represented as intentional risk | Developer Source only, high-friction local ceremony, permanent badge, audit, and explicit unrestricted local code-execution disclosure are defined |
| Plugin that installs other plugins | Deliberately unsupported | Core marketplace is the only installer; plugin may navigate to it but receives no lifecycle authority |
| Directly reachable remote Node | Represented | mTLS device identity, pairing fingerprint, Node-qualified resources, per-Node socket, and single-Node mutation boundary are defined |
| Opaque relay/mobile monitor | Constrained extension | Application-layer encryption and fallback are constrained, while relay and mobile delivery remain outside V2 |

## Findings

### `REVIEW-PPH-001` — High — The manifest cannot encode the normative contribution catalog

**Evidence**

`plugins/contribution-catalog.md` requires common `label`, `description`, `order`, `when`,
`requires`, and `fallback` fields and defines behavior-specific bodies for every contribution.
Examples include:

- task panes with icon, minimum width, retention, availability, and fallback;
- keybindings with one of six scopes;
- pollers with interval, jitter, timeout, overlap policy, visibility relevance, failure backoff,
  and command identity;
- notifications with deduplication, privacy class, expiration, toast policy, target navigation,
  and actions;
- context sections with snapshot budget and sensitivity;
- agent tool renderers matched by tool schema;
- navigation intents with target patterns and resource mapping; and
- commands with input acquisition, resource scope, repeatability, and confirmation.

`contracts/schema/plugin-manifest-v2.schema.json` cannot encode those contracts:

- its outer contribution has only `id`, `type`, `artifact`, and `definition`;
- `viewContribution` omits icon, minimum width, retention, availability predicate, requirements,
  contribution version, and a typed fallback;
- `keybindingContribution` has command, shortcut, and a string predicate, but no binding scope;
- `workerContribution` has only kind, operation, nullable schedule, and event names;
- `eventUiContribution` reduces notification, attention, badge, and notice-kind to event, renderer,
  and severity;
- `commandContribution` uses the same command/title/confirmation shape for a navigation intent and
  has no target matcher or resource mapping; and
- there are no dedicated machine definitions for context-section or agent-tool-renderer semantics.

The schema also has no field satisfying `PLUG-CONTRIB-005`, which requires the capability version
of every contribution kind.

This is observable in the current-plugin and Herdr material: GitHub checks, Agent attention,
Docker badges, Terminal drawer slots, Editor renderer providers, Notes context, pane sizing,
notification bridges, scoped keybindings, and all eight Herdr link-handler repositories depend on
fields that cannot be serialized in the authoritative manifest.

**Impact**

An implementer must invent manifest extensions or hard-code first-party exceptions. Either choice
breaks the promised common model, makes Community behavior less expressive than System behavior,
and invalidates the claim that 89 Herdr plugins are safely representable. Link patterns,
notification privacy, worker overlap, pane retention, and keybinding scope are also security or
behavior fields, so defaults cannot safely be inferred.

**Required closure**

1. Give every catalog kind a closed, versioned schema whose fields exactly implement the normative
   catalog.
2. Add the common metadata, predicate, requirement, and fallback model or explicitly define which
   kinds use a safe subset.
3. Add cross-field validation for outer kind, artifact/runtime/target, required query/action/
   command/event declarations, dependency, renderer, trust, and fallback.
4. Produce machine-valid manifest fixtures for every contribution kind and for each of the twenty
   current plugins.
5. Generate representative manifests for all Herdr archetypes, including every observed link,
   startup, keybinding, notification, and pane placement.

**Closure verification**

Schema validation and semantic conformance must accept every declared first-party/Herdr mapping and
reject missing scope, missing fallback, undeclared target pattern, unsafe predicate, unsupported
worker policy, and trust-incompatible contribution.

### `REVIEW-PPH-002` — High — Renderer capability and renderer-node identifiers conflict

**Evidence**

`ui/renderers/README.md` defines negotiated capability families such as `acorn.layout/2`,
`acorn.content/2`, `acorn.collection/2`, and specific providers including
`acorn.file-tree/2`, `acorn.log/2`, and `acorn.agent-timeline/2`. It places renderer node IDs such
as `acorn.stack/1`, `acorn.status/1`, and `acorn.table/2` inside those capability families.

Other normative material uses incompatible identifiers:

- `ui/renderer-capability-negotiation.md` names `acorn.resource-tree` rather than
  `acorn.file-tree`;
- Changes requires `acorn.form/1` and `acorn.confirmation/1`, while the catalog defines
  `acorn.form/2` and no standalone confirmation renderer;
- Notes requires `acorn.markdown-editor/2`, which is not in the catalog;
- Agents requires `acorn.agent-center/2`, which is not in the catalog;
- GitHub requires `acorn.log-stream/2`, while the catalog defines `acorn.log/2`; and
- the machine-valid example manifests advertise `acorn.status/1` and `acorn.table/1` as negotiated
  capabilities even though the catalog makes status a content node and specifies table version 2.

The shared capability schema accepts all these strings, so syntactic validation does not detect
the semantic conflict.

**Impact**

Electron and a Node cannot deterministically negotiate the current-plugin views. Agents, GitHub,
Notes, Changes, Database, Editor, and Herdr terminal/file/review plugins can validate a manifest
yet fail at activation or render with different semantics. A developer must decide whether a
manifest advertises capability families, leaf renderers, or both, and must invent fallback for
undefined names.

**Required closure**

1. Publish one canonical registry separating negotiated capability IDs from UI-document node IDs.
2. Define the exact major/minor negotiation rule for each family and how a contribution declares
   leaf-node requirements.
3. Replace every undefined or stale current-plugin, Herdr-archetype, and example identifier.
4. Make manifest semantic validation reject leaf IDs used as capability families, unknown majors,
   and renderer nodes not covered by a negotiated family.
5. Add fixtures for Agent Center, Markdown editing, confirmations, logs, file trees, and every
   current-plugin fallback.

**Closure verification**

The twenty current-plugin manifests and all complete examples must negotiate successfully against
minimum and current Electron capability fixtures, and deterministic missing-capability tests must
select the specified fallback.

### `REVIEW-PPH-003` — High — Scheduled, startup, and long-running workers lack an executable contract

**Evidence**

The contribution catalog requires poller interval, jitter, timeout, overlap, visibility relevance,
failure backoff, and command identity. The manifest worker shape contains only `kind`, `operation`,
`schedule`, and `events`.

The canonical WIT world exports `initialize`, `handle-query`, `handle-command`, `handle-event`,
`health`, and `shutdown`. It provides no scheduler tick, start-service, readiness transition,
heartbeat, stream subscription, timer registration, wakeup, checkpoint, or worker-control
interface. Its host imports likewise expose no deterministic scheduling handle. A
`background-worker` with `schedule: null` and no incoming event has no defined invocation that can
start or continue its work after `initialize` returns.

This conflicts with:

- the complete WASI example's deterministic timer scheduling;
- Workflows' durable scheduler;
- Docker's background `docker events` worker;
- the complete native example's subscribe/drain protocol;
- the Herdr matrix's six startup-hook repositories and seven startup entries; and
- numerous source-observed daemons, watchers, relays, pollers, supervisors, build monitors, and
  notification bridges.

**Impact**

Startup reconciliation, background monitoring, overlap prevention, backoff, drain, restart, and
quarantine cannot be implemented from the normative machine contracts. Treating `initialize` as an
implicit daemon entrypoint would conflict with its request deadline and would leave scheduling,
readiness, and cancellation undefined. The affected Herdr rows cannot currently be classified
Supported.

**Required closure**

1. Define distinct scheduled invocation, event subscription, and resident-service contracts.
2. Extend the manifest with minimum interval, jitter, timeout, overlap/coalesce/queue policy,
   visibility policy, backoff, checkpoint, startup, readiness, heartbeat, drain, and restart fields
   with safe defaults and bounds.
3. Add WIT exports/imports for scheduler ticks and, if resident WASI services remain supported,
   supervised start/readiness/heartbeat/drain with cancellation and resource budgets.
4. Define native-process parity for the same lifecycle without pretending its IPC is the WIT
   world.
5. Map every Herdr `S` and `W` row to one of the concrete worker modes.

**Closure verification**

Conformance must cover Node restart, duplicate tick/event, missed schedule, clock jump, overlap,
event burst, worker hang, crash loop, update drain, grant revocation, cursor gap, and quarantine for
WASI and native workers.

### `REVIEW-PPH-004` — High — Current-plugin commands and events are catalogs, not complete contracts

**Evidence**

`plugins/commands-actions-and-custom-events.md` requires every plugin command declaration to fix
stable ID/version, input and result schemas, target scope, capabilities, idempotency,
preconditions, deadline, cancellation, confirmation, effects, result events, and closed errors.
The programme also requires authentication, authorization, commit point, optimistic concurrency,
retry safety, and timeout for every mutation.

The current-plugin documents generally list names and a result summary but do not provide those
fields per operation. Representative cases include:

- Changes groups stage/unstage, commit/push, and note mutations in single table rows without
  per-command schemas, deadlines, cancellation, error sets, or exact resulting events;
- Database lists connection, arbitrary SQL, row mutation, saved-query, and generation commands
  without a complete command matrix;
- Docker lists all lifecycle, prune, Compose, teardown, stream-open, and exec commands, then gives
  only selected cross-cutting rules;
- HTTP lists create/replace/delete/send/cancel/import but omits complete per-command commit and
  retry definitions; and
- Notes, Memory, Context, Linear, Rollbar, Model Providers, Onboarding, and the executable profiles
  use the same prose-catalog pattern.

The complex plugin documents are richer but still do not provide referenced machine schemas or a
complete uniform declaration for every command/event. No current-plugin package has a canonical
machine manifest and schema set in the specification.

Custom events are similarly named in families such as `created|updated|deleted` or
`completed|failed`, without a schema reference, complete payload shape, sensitivity, redaction,
retention snapshot, and producer namespace declaration for each fact.

**Impact**

A developer must choose wire fields, command retry behavior, commit points, errors, and event
payloads. That violates the implementation-ready completion gate and makes parity tests unable to
distinguish safe retries from duplicate Git pushes, provider comments, HTTP sends, SQL execution,
agent prompts, Docker actions, or workflow transitions.

**Required closure**

1. Add a complete command declaration and immutable input/result schema for every current-plugin
   mutation.
2. Add a complete query declaration for every current-plugin read and a stream profile for every
   stream.
3. Add one schema and sensitivity/redaction/snapshot declaration per published or consumed event.
4. State the exact resulting events, including explicit no-event outcomes, for every commit point.
5. Validate one canonical manifest and all referenced contracts for each of the twenty packages.

**Closure verification**

For every current-plugin command, a generated matrix must show authentication, authorization,
target, idempotency, expected revision, cancellation, timeout, errors, commit point, event sequence,
retry safety, and parity scenario, with no field supplied by implementer convention.

### `REVIEW-PPH-005` — High — Lifecycle state names are defined, but individual transitions are not

**Evidence**

`plugins/lifecycle-and-state-machines.md` supplies state sets and says every transition definition
must specify ten properties. It does not actually define those properties for each allowed edge.
For example, `absent → resolving`, `verifying → awaiting_permission`,
`staging → awaiting_setup`, `activating → active`, `active → updating`,
`rolling_back → disabled`, `quarantined → activating`, `uninstalling → retained`, and
`retained → purging` have no individual initiating command, preconditions, persisted phase,
timeout, commit point, failure event, restart reconciliation, or recovery result.

`installation-update-and-rollback.md` gives a useful ordered happy path and cross-cutting rules, but
does not close every edge or define stable install/update/disable/quarantine/uninstall/purge
command input/result contracts. The OpenAPI intentionally routes generic commands and therefore
does not fill this domain gap.

**Impact**

The coordinated Node/client installation transaction cannot be implemented deterministically.
Different implementations can disagree about whether a partial client acquisition is active,
whether setup cancellation retains data, when old handles are revoked, what restart resumes, and
which command recovers a failed/quarantined state. Every current and Herdr plugin relies on this
lifecycle.

**Required closure**

1. Assign a stable command contract to every allowed lifecycle edge.
2. Complete the required ten-property transition record for every edge, including permission,
   setup, runtime-health, update, rollback, disablement, quarantine, uninstall, retained-data,
   purge, and reinstall state machines.
3. Define explicit failure-state and resume-target mapping for interruption at every durable phase.
4. Add Node/client partial-install state and acknowledgment transitions rather than describing them
   only in prose.
5. Bind every lifecycle event to one transition and event schema.

**Closure verification**

A model-based fixture must enumerate every allowed edge and prove the command, persisted state,
event, restart result, user result, and recovery command. Every non-enumerated edge must fail with
`invalid_lifecycle_transition`.

### `REVIEW-PPH-006` — High — Three first-party runtime classifications still require an architectural choice

**Evidence**

- `current-plugins/changes.md` says its Node artifact **SHOULD** be WASI and **MAY** later become
  declarative-only. It does not select the V2 runtime.
- `current-plugins/README.md` describes Docker as a “sandboxed native process/stream worker,” while
  `current-plugins/docker.md` specifies a WASI parser/policy component invoking a core-owned fixed
  Docker process and explicitly denies direct socket access.
- `current-plugins/database.md` selects WASI plus a core PostgreSQL broker but permits a fallback
  Verified native runtime when a platform broker lacks a driver, without defining the supported
  platform matrix or the exact selection/failure rule.

**Impact**

The package artifacts, sandbox, permissions, host interfaces, updater, conformance suites, and
failure behavior differ by runtime. A developer cannot produce these packages without choosing an
architecture that the specification says is already decided. Docker in particular has
contradictory normative descriptions.

**Required closure**

1. Select one V2 runtime/artifact set for Changes.
2. Reconcile the Docker index, Docker plugin specification, native example, and manifest into one
   explicit shipped design.
3. Publish Database's supported platform/driver matrix and either fully specify the native
   fallback artifact and sandbox or fail closed where the broker is absent.
4. Update package manifests, trust ceremonies, health, update, and parity tests to the selected
   runtime.

**Closure verification**

Each of the three plugins must have one deterministic artifact selection for every supported
Node platform, with no `SHOULD`, optional architecture branch, or contradictory runtime label left
to the implementer.

### `REVIEW-PPH-007` — High — Developer Source and Herdr build entries have no machine build/install contract

**Evidence**

The security and installation prose correctly require exact commit pins, isolated credential-free
builds, digest-locked dependencies, no install scripts, SBOMs, provenance, and Developer Source
labelling. The Herdr matrix maps 53 build-bearing repositories and 59 build entries to an isolated
source build.

No normative machine contract defines:

- the Git repository URL and exact commit input to the install command;
- submodule policy and exact source-tree digest;
- a hermetic build-plan format;
- builder image/toolchain/runtime digests;
- dependency fetch and lock inputs;
- allowed build steps without creating an install-script escape;
- CPU, memory, disk, time, output, and network limits;
- artifact output mapping into the plugin manifest; or
- the install command's idempotency, cancellation, resumable phases, result, and errors.

The plugin manifest explicitly treats source/build provenance as evidence rather than execution
instructions, which is correct for published artifacts but leaves Developer Source build execution
without another schema.

**Impact**

The Git-repository installation path cannot be implemented safely or interoperably, and Herdr
build-bearing rows cannot be ported through the promised flow. Letting a builder infer `build`,
package-manager, or repository scripts would recreate the prohibited install-script authority.

**Required closure**

1. Define a signed or locally acknowledged, closed build-plan schema separate from the runtime
   manifest.
2. Define source acquisition, exact-tree/submodule/dependency locking, hermetic toolchain, resource
   limits, network phase separation, output declaration, log redaction, provenance, and failure
   semantics.
3. Define the Developer Source install/update command input/result and resumable state.
4. State which Herdr build forms are translatable, which require an author-provided Acorn build
   plan, and which are deliberately unsupported.

**Closure verification**

Conformance must reject branch/tag/short-SHA drift, undeclared submodules/dependencies, hooks,
package install scripts, credential/network/home/metadata access, undeclared outputs, output
mutation, and non-reproducible artifact substitution.

### `REVIEW-PPH-008` — High — The one-hundred-row Acorn mapping is archetypal rather than contract-complete

**Evidence**

The matrix accurately records source actions, panes, consumed Herdr events, startup/link/build
counts, source-observed workers, and concise target categories. Its Acorn columns commonly say
“command,” “wizard,” “progress events,” “own config/history,” “optional Git/provider capability,”
or another archetype summary.

They do not provide, per row:

- stable Acorn contribution and command IDs;
- command/query/event input and result schema references;
- published custom event types versus an explicit “publishes none”;
- stream profile IDs and bounds;
- worker mode and complete scheduler/supervision policy;
- storage schema/quota/backup/retention choice;
- exact dependency coordinates/version/capability/event edges;
- renderer capability versions and desktop/fallback behavior; or
- lifecycle archetype/version and row-specific setup/update/uninstall exceptions.

For example, `HERDR-010` requires a regex link handler but maps only to a navigation intent;
`HERDR-019` has a startup reconciler but no concrete scheduler descriptor; terminal-tool rows name
a “fixed tool” without a manifest contract; and many Supported rows name “progress events” without
declared event coordinates or schemas. The shared lifecycle paragraph is valuable but cannot
supply row-specific authority, worker, state, and compensation fields.

**Impact**

The assertion that every Supported row can be represented safely is not yet falsifiable by schema
validation. A plugin author still has to design the missing contract, and some designs encounter
the gaps in `REVIEW-PPH-001`, `-002`, `-003`, and `-007`. The 89/7/4 disposition count therefore
describes architectural intent, not completed compatibility.

**Required closure**

1. Add a machine-readable or equivalently complete per-row mapping with stable IDs and references
   for contributions, operations, events, streams, workers, storage, permissions, dependencies,
   lifecycle, and renderer/fallback.
2. Link every row to one versioned archetype and enumerate all row-specific overrides.
3. Generate and validate a manifest/contract fixture for each distinct archetype plus every
   exceptional row.
4. Re-run the disposition after findings `REVIEW-PPH-001`, `-002`, `-003`, and `-007` close.
5. Change any row whose required contract remains outside V2 from Supported to a named Extension or
   deliberate product decision.

**Closure verification**

An automated trace must resolve all one hundred rows to valid manifest fields and contract
artifacts, prove that each observed source surface has one target disposition, and reproduce the
Supported/Extension/Unsupported total without an unmapped behavior.

### `REVIEW-PPH-009` — Medium — The Terminal drawer's shipped default toggle shortcut is not fixed

**Evidence**

Current source registers `task.terminal.toggle` with default chord `meta+shift+t`; current shipped
pane documentation also lists `⌘⇧T` for the Terminal toggle. The V2 desktop parity shortcut table
lists the twelve pane chords but omits Terminal. The Terminal specification lists focus sessions
1–9, previous/next, maximize, and focused close defaults, while its open/close drawer command has no
default chord.

**Impact**

An implementation can preserve the drawer and still omit or reassign one current default shortcut,
contrary to the locked fresh-install shortcut parity requirement.

**Required closure**

Add `Cmd+Shift+T` / `meta+shift+t` as the default task-context binding for
`task.terminal.toggle`, subject to the same reserved-key, conflict, override, typing-protection, and
accessibility behavior as existing shortcuts.

**Closure verification**

Desktop parity tests must open and close the task Terminal drawer with the default chord, show it in
Settings and the button tooltip, honor overrides/reset, and leave the command available when a
conflict unbinds it.

### `REVIEW-PPH-010` — Medium — The V1 route and data inventory is distributed rather than traceable

**Evidence**

The plugin documents describe current routes and target ownership well, and the migration baseline
correctly says V1 HTTP paths are not compatibility contracts. However, there is no single
route/table/event/contribution ledger tying every current implementation item to:

- a target core/plugin owner;
- a V2 query, command, event, stream, or deliberate removal;
- a clean-start import decision; and
- a parity scenario.

The database schema currently contains 47 tables, and the renderer/service surfaces are composed
through multiple activation registries. Literal V1 table names are sometimes included
(`review_notes`, `db_saved_queries`, `http_requests`, `workflow_runs`) and sometimes represented
only by target aggregate names. The same is true for internal routes and private WebSocket frames.

**Impact**

Reviewers can establish coverage by reading all plugin documents and source, but an implementer or
cutover test cannot mechanically prove that a low-visibility route, table, event frame, poller,
slot, or setting was migrated or deliberately removed. This creates a parity regression risk even
though no specific omitted feature beyond `REVIEW-PPH-009` was found.

**Required closure**

Add one V1-to-V2 traceability appendix generated or checked against source. Each current table,
route group, WebSocket/client event family, pane/source/slot/poller/settings contribution, and
public `/api/v1` group must identify its target owner/contract or deliberate removal and its
acceptance scenario.

**Closure verification**

The ledger count must match source inventories and fail when a new V1 surface is present without a
V2 disposition. It must include all 47 current tables, all plugin route mounts, all internal stream
families, all registered client contributions, and all twenty-five coupling edges.

## Closure order

The findings should be resolved in this dependency order:

1. `REVIEW-PPH-001` contribution schema and `REVIEW-PPH-002` renderer registry;
2. `REVIEW-PPH-003` worker runtime and `REVIEW-PPH-005` lifecycle transitions;
3. `REVIEW-PPH-007` source-build/install contract;
4. `REVIEW-PPH-006` first-party runtime selections;
5. `REVIEW-PPH-004` complete current-plugin operation/event contracts;
6. `REVIEW-PPH-008` regenerated Herdr mappings and dispositions; and
7. parity/traceability findings `REVIEW-PPH-009` and `REVIEW-PPH-010`.

This order prevents current-plugin and Herdr manifests from being authored against contribution,
renderer, worker, lifecycle, or build contracts that are subsequently replaced.

## Closure disposition

| Finding | Resolution evidence | Verified result |
| --- | --- | --- |
| `REVIEW-PPH-001` | contribution schema/catalog and 28-kind fixture set | closed |
| `REVIEW-PPH-002` | renderer capability negotiation and renderer-node catalog | closed |
| `REVIEW-PPH-003` | worker schema, WIT worker exports and supervised-worker lifecycle | closed |
| `REVIEW-PPH-004` | current-plugin operation contract and payload catalogs; release manifest/schema gate | closed |
| `REVIEW-PPH-005` | exhaustive lifecycle transition catalog and descriptor projection | closed |
| `REVIEW-PPH-006` | current-plugin dossiers and corrected declarative-only fixture artifacts | closed |
| `REVIEW-PPH-007` | source-build-plan schema, isolated builder and per-row build dispositions | closed |
| `REVIEW-PPH-008` | Herdr materialized fixture and semantic payload/authority validation | closed |
| `REVIEW-PPH-009` | desktop parity contract fixes the Terminal drawer shortcut | closed |
| `REVIEW-PPH-010` | 190-operation V1 ledger, 47-table inventory and 25-edge coupling map | closed |

**`REVIEW-PPH-FINAL-001`:** The programme establishes the intended plugin architecture, documents
all twenty current plugins, inventories every baselined coupling edge, closes current-plugin
operation fields and preserves the desktop feature set. Every frozen Herdr row has a validated
representation or explicit Extension/Unsupported decision. This review no longer blocks
`ACCEPT-MIG-060`.
