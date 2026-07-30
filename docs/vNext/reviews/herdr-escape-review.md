# Herdr top-100 independent escape review

**Status:** Closure re-review complete; no Critical, High or Medium finding remains<br>
**Review date:** 2026-07-31<br>
**Reviewer:** Herdr compatibility escape-review track<br>
**Requirement prefix:** `REVIEW-HERDR`<br>
**Finding prefix:** `REVIEW-HERDR`

## Verdict

The closure assertion now passes. The frozen source evidence still reproduces all 100 repositories
and every observed manifest surface, and the new machine fixture validates as a whole. It
materializes 449 operations, 898 digest-pinned input/result schema documents, 105 installable task
panes, 42 operation-bound streams, 51 supervised workers and one namespaced custom event. All
cross-object references, canonical digests, capability unions, event grants, worker bindings,
stream bindings and task-pane query bindings passed independent checks.

All original findings `REVIEW-HERDR-001` through `REVIEW-HERDR-009` are closed. The final
classification remains 89 Supported, seven Extension and four Unsupported, with every non-Supported
row carrying a closed extension or product-decision record. No Critical, High or Medium Herdr
finding remains. `HERDR-ARC-025` and `HERDR-CLOSE-002` are independently verified for the frozen
2026-07-30 corpus.

## Scope and method

The review inspected:

- [the top-100 matrix](../examples/herdr-top-100-compatibility-matrix.md);
- [the deterministic expansion ledger](../examples/herdr-contract-archetypes.md) and
  [community archetypes](../examples/community-plugin-archetypes.md);
- the frozen 416-record marketplace snapshot, the 100-repository analysis ledger and all 100 exact
  commit archives retained in the review corpus;
- all 101 archived `herdr-plugin.toml` files and their action, pane, event, startup, link, build,
  key and theme declarations;
- the manifest, contribution, operation, capability, worker, source-build, view-session and UI
  schemas;
- the WASI WIT world, native runtime, collaboration, permission, lifecycle, renderer, semantic UI,
  bespoke UI and security contracts; and
- adversarial composites covering terminal panes, Agent status, worktrees, actions, keybindings,
  link handlers, startup hooks, daemons, source builds, credentials, notifications, cross-plugin
  calls, workers, custom events, client presentation state and bespoke UI.

The review did not modify any normative specification. It preserves the original findings and
closure criteria below, followed by the evidence that independently closes each one.

## Evidence verification

### Checks that passed

- **`REVIEW-HERDR-PASS-001`:** The matrix has exactly one data row for every integer
  `HERDR-001` through `HERDR-100`, with no gap or duplicate.
- **`REVIEW-HERDR-PASS-002`:** Sorting the 416 records actually present in the frozen fixture by
  stars descending and then `pushedAt` descending reproduces the matrix order. All 100 repository,
  star and language values match.
- **`REVIEW-HERDR-PASS-003`:** Every row contains a full 40-character commit link and a source-tree
  link to the same commit. Every archived repository root names that same commit.
- **`REVIEW-HERDR-PASS-004`:** The archives contain 101 manifests. All parse as TOML, every
  manifest path matches the ledger, every product version is recorded, the two dual-manifest
  repositories are disclosed, and `HERDR-083` correctly records manifest absence.
- **`REVIEW-HERDR-PASS-005`:** All row summaries are non-empty and are supported by repository
  description, README, manifest or inspected entrypoint evidence. The access date is consistently
  inherited from `HERDR-METHOD-001` through `-003`.
- **`REVIEW-HERDR-PASS-006`:** Per-repository de-duplicated `A`, `P`, `E`, `S`, `L` and `B`
  counts match the manifests. The aggregate source totals reproduce exactly: 294 action entries,
  108 panes, 130 consumed-event entries, 59 builds, ten link handlers and seven startup entries.
- **`REVIEW-HERDR-PASS-007`:** The aggregate repository counts reproduce exactly: 90 with actions,
  66 with panes, 41 with consumed events, 53 with builds, eight with link handlers and six with
  startup hooks. The matrix records 35 source-observed workers/daemons.
- **`REVIEW-HERDR-PASS-008`:** The expansion ledger assigns every row to exactly one of 35
  archetypes. No row is missing or assigned twice.
- **`REVIEW-HERDR-PASS-009`:** The disposition arithmetic is exactly 89 Supported, seven Extension
  and four Unsupported. Every non-Supported row names one of the declared extensions or product
  decisions.
- **`REVIEW-HERDR-PASS-010`:** The architecture correctly rejects direct plugin imports,
  cross-plugin SQL, ambient credentials, event-as-authority, unsandboxed Community native code and
  plugin-controlled installation. Those boundaries contained the corresponding adversarial
  attempts.
- **`REVIEW-HERDR-PASS-011`:** The complete fixture validates against
  `herdr-fixture-set-v2.schema.json`; the 22 authoritative JSON Schemas compile under JSON Schema
  2020-12 validation. The family-confusion, raw-secret, navigation-regex and bespoke-network
  negative fixtures are rejected, while the signed bespoke-view positive fixture is accepted.
- **`REVIEW-HERDR-PASS-012`:** Independent canonical-JSON hashing reproduced all 449 operation
  descriptor digests and all 898 operation-schema digests. Every schema URI equals its document
  `$id`, every operation has exactly one input and one result document, and all 898 `$id` values
  are unique.
- **`REVIEW-HERDR-PASS-013`:** Every manifest permission request is in the exact union of its
  operations' authorization requirements; contribution and stream grants are subsets of that
  union. The publish/subscribe grant selectors equal the manifest event declarations.
- **`REVIEW-HERDR-PASS-014`:** All 105 installable task panes bind to a declared query; all 42
  streams are referenced by operations; all 51 workers bind to a declared command and contribution.
  Worker modes reproduce 19 resident, 31 event-driven and one scheduled worker.
- **`REVIEW-HERDR-PASS-015`:** Every one of the 130 source event occurrences has exactly one
  disposition: 76 Node facts and 54 client-presentation events. The latter affect the expected 19
  repositories; 18 installable rows carry bounded client-device presentation contributions and
  the remaining row is explicitly Unsupported.
- **`REVIEW-HERDR-PASS-016`:** All ten link handlers, 17 keybinding entries, one theme declaration
  and 59 source build entries reproduce from the exact manifests. The build entries resolve to 56
  author-plan-required Developer Source records and three explicit Unsupported decisions.
- **`REVIEW-HERDR-PASS-017`:** Operation-payload semantic validation distinguishes 105 pane query
  results, 42 stream-opening command results, ordinary settled command results and local
  presentation results. No result is a status-only placeholder. The 422 empty input objects are
  restricted to inspected fixed actions with no user-supplied fields; target resource and command
  envelope fields are intentionally not duplicated. The six recent-navigator focus operations are
  local client commands with no Node grants, while CLI-backed `status`/`list`/`validate` actions
  remain commands under the process-effect rule.

### Surface trace result

| Source need | Corpus evidence | Declared Acorn route | Review result |
| --- | --- | --- | --- |
| Actions | 294 entries in 90 repositories | command contribution plus operation descriptor | Closed; exact evidence and declared operation/action bindings validate |
| Panes | 108 entries in 66 repositories | task/shell/Fleet contributions and semantic or bespoke views | Closed; 105 installable panes bind to queries and three belong to explicit Unsupported rows |
| Consumed events | 130 entries in 41 repositories | Node durable facts or bounded client-presentation state | Closed; exact 76/54 disposition and installable client contracts validate |
| Startup | seven entries in six repositories | desired-state reconciler plus worker lifecycle | Closed; five installable entries have bound workers and two have one Unsupported decision |
| Links | ten handlers in eight repositories | bounded navigation intent | Closed; exact handlers use typed templates and declared destinations |
| Workers | 35 observed repositories | scheduled, event-driven or resident worker | Closed; 51 concrete workers cover the required behavior in all three modes |
| Builds | 59 entries in 53 repositories | isolated Developer Source build disposition | Closed; 56 await an author plan and three are explicitly Unsupported |
| Credentials | provider, ntfy, relay, Telegram, telemetry, Convex and other integrations | opaque reference plus destination/purpose-bound broker | Closed; operation-specific grants validate with no raw-secret authority |
| Storage | cursors, configuration, caches, journals, indexes, artifacts and history | installation-private SQLite/blob storage | Closed; each installable row declares storage, quota, backup and retention policy |
| Dependencies | core, Agents, Terminal, GitHub, provider/profile and optional integration edges | manifest dependency plus delegated capability/event broker | Closed; dependency and capability/event edges are materialized in each manifest |
| Keymaps/theme | seven host chords, ten renderer-semantic bindings and one theme | host keybinding or renderer/appearance semantics | Closed; all 18 declarations have deterministic dispositions |

## Findings

Finding titles and original evidence describe the pre-closure state. The
`REVIEW-HERDR-CLOSE-*` paragraph in each section is the authoritative final disposition.

### `REVIEW-HERDR-001` — High — The deterministic fixture coordinate is invalid for all 100 rows

**Original evidence (pre-closure)**

`HERDR-ARC-001` defines every compatibility coordinate as
`community.herdr/<normalized-owner-and-repository>`.
`plugin-manifest-v2.schema.json` requires each coordinate segment to match
`[a-z][a-z0-9-]{1,62}`. The publisher segment `community.herdr` contains a dot and therefore makes
all 100 generated coordinates invalid.

Even if the publisher were changed to `community-herdr`, two generated package segments still fail
the leading-letter rule:

- `HERDR-025` becomes `0cv-herdr-mobile-relay`; and
- `HERDR-072` becomes `0xgosu-herdr-auto-pilot`.

The latter is labelled Supported. The former cannot produce even a schema-valid disabled Extension
fixture. This is a direct contradiction of `HERDR-ARC-012`, which says all 100 expansions validate.

**Original impact**

No deterministic Herdr manifest produced by the documented algorithm can pass the authoritative
manifest schema. The expansion ledger is therefore not executable even before operations,
permissions or artifacts are considered.

**Closure criterion**

Define one normalization algorithm that always emits a valid publisher/package coordinate,
including deterministic treatment of digit-leading names, length overflow, collisions and reserved
identifiers. Generate all 100 coordinates, validate them against the manifest schema and preserve a
source-repository-to-coordinate ledger so a later algorithm change cannot silently change identity.

**`REVIEW-HERDR-CLOSE-001` — Closed**

`HERDR-ARC-001` now specifies `community-herdr/p-<slug6>-<digest>` using a lowercased repository
key, NFKC normalization, a bounded six-character slug with a `plugin` fallback, and the full
unpadded lowercase RFC 4648 base32 SHA-256 digest. Independent regeneration produced exactly the
100 checked-in coordinates, including digit-leading repositories and the separator boundary in
`HERDR-026`; all coordinates are unique and validate through the manifest schema. The fixture's
`coordinateBinding` preserves the canonical repository key and algorithm version.

### `REVIEW-HERDR-002` — High — The claimed 100-row expansion has not been materialized or validated

**Original evidence (pre-closure)**

The expansion document says conformance “generates” manifest, contribution, operation, worker and
build fixtures, but the documentation contains no generated Herdr fixture set and no 100-row
machine trace. The 35 archetype rows are prose summaries. They do not supply, per plugin:

- complete action/query/capability operation descriptors and digest-pinned input/result schemas;
- exact event coordinates, payload schemas, filters, snapshot queries, redaction and dead-letter
  rules, including `HERDR-076`'s custom wake event;
- stream profile IDs, ownership, media type, byte/replay/cancellation bounds;
- worker descriptors, modes, checkpoints, resource ceilings and recovery policy;
- storage schema, quota, backup choice, migration and uninstall retention;
- exact capability requests, resource selectors and operation subsets;
- exact dependency coordinate, version and capability/event edge;
- renderer major, leaf-node requirements, desktop behavior and mobile fallback; or
- setup, lifecycle and row-specific update/uninstall exceptions.

`HERDR-ARC-003` itself requires an “inspection fixture” to state each action's input fields.
`HERDR-ARC-002` requires the exact inspected link pattern in “its fixture.” Neither fixture class
exists. Generic phrases such as “optional Git/provider capability,” “own config/history,”
“progress events,” “fixed process where needed” and “destination-bound network/secret” require an
implementer to choose security- and behavior-bearing values.

**Original impact**

The Supported assertion is not falsifiable by schema validation. A plugin can satisfy the prose
archetype while choosing incompatible authority, operation, event, storage, worker or lifecycle
semantics. The same omission hides whether an observed behavior has been dropped during the port.

**Closure criterion**

Create a machine-readable 100-row fixture set. Each row must resolve to immutable manifest,
contribution, operation, event, stream, worker, storage, permission, dependency, lifecycle,
renderer/fallback and build/product-decision records. Validate every distinct object against the
pinned schemas, validate cross-object references, record explicit empty sets, and publish the
generated result/arithmetic. Unsupported rows need closed decision records; Extension rows must
validate and fail activation only because the named extension is unavailable.

**`REVIEW-HERDR-CLOSE-002` — Closed**

`herdr-top-100-fixtures.json` is the required 100-row machine fixture and validates against
`herdr-fixture-set-v2.schema.json`. It contains 449 operations—310 Node commands, 105 queries and
34 client commands—and 898 closed input/result schema documents. Independent canonical hashing
reproduced every operation and schema digest; URI/`$id`, manifest descriptor, action/query,
task-pane, stream, worker, capability and event references all agree. All 105 installable panes
bind to one declared query, every one of 42 streams is operation-bound and every one of 51 workers
is command-bound. Unsupported rows carry closed decision records; Extension rows remain
schema-valid and are activation-blocked only on their named extension.

### `REVIEW-HERDR-003` — High — Capability-family closure and least authority are inconsistent

**Original evidence (pre-closure)**

The matrix explicitly abbreviates `core.repository`, `core.task`, `core.events`,
`core.clipboard`, `core.notification`, `core.storage` and `core.provider`, and repeatedly requires
worktree create/remove. The plugin permission catalog lists these as capability families.

The authoritative capability schema's closed `securityConstraints` union has no corresponding
repository, task, worktree, event, clipboard, notification, storage or provider constraint shape.
It also does not bind the capability ID family to `constraints.family`. A strict schema validation
accepts this semantically confused request:

```json
{
  "kind": "permission-request",
  "id": "core.task/2",
  "revision": 1,
  "scope": "task",
  "required": true,
  "reason": "Demonstrate family confusion",
  "constraints": {
    "family": "workspace",
    "operations": ["read"]
  }
}
```

The only concrete worktree command name found in the examples is
`core.worktree.create.v1`; no closed capability/constraint contract establishes its create/remove/
open arguments, policy or grant family.

The row mappings also use archetype unions rather than least authority. For example,
`HERDR-039` only swaps to the previously focused workspace and `HERDR-060` only fuzzy-navigates,
yet both say “workspace/task/repository read or mutate; Git worktree; narrowly fixed process where
needed.” `HERDR-045` opens diffs but inherits optional provider request and Agent prompt authority.

**Original impact**

An implementer must either invent missing capability families, map them to unrelated constraints,
or hard-code semantic checks outside the machine contract. The current schema admits a
family-confused request, while the matrix cannot prove minimum authority for Supported rows.

**Closure criterion**

Reconcile the prose and schema into one closed family registry. Either add the missing constraint
variants or map every advertised family to an existing one with exact semantics. Bind capability
ID to constraint discriminator in schema/semantic validation. Publish exact worktree operations.
Then give every Herdr operation its minimum concrete capability IDs, operations, selectors,
constraints and confirmation policy; remove all “or mutate,” “optional,” and “where needed”
authority from final generated fixtures.

**`REVIEW-HERDR-CLOSE-003` — Closed**

`capability-v2.schema.json` now has a closed discriminator-bound constraint union for every family
used by the fixture. The family-confusion and raw-secret negative fixtures are rejected.
Independent set comparison confirmed that every manifest request is used by at least one declared
operation and every operation grant is requested. The previously over-broad examples are now
operation-specific: `HERDR-012` apply and `HERDR-039` toggle are capability-free client commands;
`HERDR-060` is read/list-only; `HERDR-019` validate is read/list-only and apply is client-local;
`HERDR-062` tab/pane presentation commands are client-local; and remove commands in `HERDR-009`,
`HERDR-019` and `HERDR-086` do not receive create/open authority.

### `REVIEW-HERDR-004` — High — Client-local focus and layout behavior is incorrectly treated as Node events

**Original evidence (pre-closure)**

`UI-STATE` correctly assigns selected Node/workspace/task, task layouts, focus, maximize, popovers
and transient selection to Electron. `HERDR-ARC-005` and `HERDR-TRACE-002`, however, state that
every Herdr event hook becomes a declared Acorn subscription with a durable cursor and snapshot.

Nineteen source repositories consume at least one `workspace.focused`, `tab.*`, `pane.focused`,
`pane.moved`, `pane.created`, `pane.closed` or `pane.exited` event. Some lifecycle events can map to
Node Terminal/Agent facts, but focus, tab layout and recency are unambiguously per-client
presentation state. Concrete Supported cases include:

- `HERDR-039`, whose entire behavior is remembering the last focused workspace;
- `HERDR-065`, whose recent navigator records focused workspaces, tabs and panes;
- `HERDR-028`, whose sidebar follows pane/tab/workspace focus;
- `HERDR-034`, which follows workspace focus into an external editor;
- `HERDR-040` and `HERDR-082`, which react to tab/pane focus and movement; and
- `HERDR-054` and `HERDR-075`, which navigate/focus presentation after notifications or popup
  lifecycle.

The matrix assigns Node-side WASI state such as “own config/history” to some of these. Yet
`UI-STATE-002` says a plugin may only declare a bounded client presentation slice, and neither the
manifest nor contribution schema contains that slice declaration or a client-local presentation
event subscription. View-session focus messages apply to one mounted view; they do not provide a
background Fleet-wide focus history.

**Original impact**

Publishing client focus through the Node product outbox would merge independent devices, turn
presentation into authoritative shared state and create privacy/noise problems. Keeping it local
leaves the declared Node worker unable to implement the Supported behavior.

**Closure criterion**

Add a per-source-event disposition table that maps every Herdr event to a Node durable fact,
client-local presentation context/event, renderer-local interaction or deliberate
unsupported/Extension decision. Define a closed, bounded client presentation slice and client
command/event contract where needed, including device scope, persistence, privacy, ordering,
reconnect and plugin-disable behavior. Reclassify any background behavior that cannot be expressed
without sending client state to the Node.

**`REVIEW-HERDR-CLOSE-004` — Closed**

Every observed event occurrence now has an explicit source-positioned disposition. Independent
matching accounts for all 130 entries exactly: 76 are Node facts and 54 are client-presentation
events. The latter occur in the expected 19 rows. Eighteen installable rows declare a bounded
client-presentation contribution with client-device persistence, client-local privacy, bounded
capacity, disable/uninstall behavior and typed client-command automations; `HERDR-008` is the one
explicitly Unsupported row. None of those focus/layout events enters the Node product outbox.

### `REVIEW-HERDR-005` — High — Link handlers have neither a complete destination contract nor a safe pattern language

**Original evidence (pre-closure)**

The corpus has ten link handlers across `HERDR-004`, `010`, `024`, `033`, `037`, `058`, `059` and
`088`. The source includes localhost routing, GitHub/GitLab issue and review links, an
`agentbox://` scheme, a report pseudo-scheme, a virtual-token URL and multi-host source links.

The matrix records only `L1`/`L2`; it does not preserve handler IDs or patterns in the row. The
archetype promises exact patterns in fixtures that do not exist. The contribution schema's
`navigation-intent` supplies `targetPatterns`, one `{resourceType,capture}` mapping and an external
policy, but it does not identify the destination command, route, pane/view or presentation action.
It also does not define whether a target pattern is a literal, template, glob or regular
expression, which engine/flags are used, complexity limits, capture syntax, overlap precedence or
collision behavior.

**Original impact**

A handler cannot deterministically route a matched link to its plugin view. Different clients may
interpret patterns differently, and treating Community-supplied strings as JavaScript regular
expressions creates a denial-of-service surface. Multi-shape handlers such as `HERDR-059` cannot be
proved to produce the intended typed resource mapping.

**Closure criterion**

Define a non-ambiguous bounded pattern grammar and matching engine, typed captures, normalization,
precedence/conflict rules and adversarial complexity limits. Add one destination union—typed
resource navigation, declared client command, Node command or declared route/view—with exact input
mapping and confirmation. Preserve all ten exact handlers in generated fixtures and test malformed,
overlapping, catastrophic, foreign-scheme and data-smuggling inputs.

**`REVIEW-HERDR-CLOSE-005` — Closed**

The contribution contract now uses a bounded literal/typed-capture grammar with typed ports,
authorityless custom schemes, path-tail limits, normalization, collision policy and a typed
destination command plus input mapping. All ten source handlers in eight repositories are
materialized. The corpus covers both optional localhost ports in `HERDR-004` and `HERDR-058`,
`report:/{path:path-tail}` in `HERDR-033`, host-specific Git providers and an allowlisted query
token. The regex negative fixture is rejected and every destination resolves to a declared
operation.

### `REVIEW-HERDR-006` — High — Resident WASI workers and plugin-produced streams lack an executable WIT path

**Original evidence (pre-closure)**

The worker schema now distinguishes scheduled, event-driven and resident workers and the WIT world
exports `handle-scheduled-tick`, `handle-event-batch` and `run-resident-worker`. That closes much of
the earlier worker-shape gap.

The resident export has no host wait, sleep, event receive, stream read or cancellation-wait
import. A Community component has no sockets, files, processes or ambient clocks, so a resident
component can only return or busy-loop through immediate host calls until fuel/CPU limits terminate
it. The generic WIT `query`, `call-capability` and `brokered-http` functions return bounded byte
lists. There is no plugin-facing stream/object create, write, credit, close or read interface even
though the prose advertises 64 MiB streamed output and streaming capability exports.

The matrix records 35 workers and explicitly maps plugin-produced job logs/artifacts, relay/export
streams, telemetry output, Agent/Terminal streams and transcript imports. Core-owned Terminal/Git/
Agent streams can return descriptors, but a plugin cannot produce its own long-lived stream or
implement an external SSE/WebSocket-style resident feed through the published WIT.

**Original impact**

Several Community Supported mappings can only be implemented by silently turning a resident worker
into polling/event ticks, inventing a WIT extension or upgrading to native execution. Stream
backpressure, cancellation, revocation and generation handoff are not enforceable for plugin-owned
content.

**Closure criterion**

Either prohibit resident Community WASI and assign every row to scheduled/event-driven invocation,
or add bounded asynchronous wait/input/heartbeat/cancellation semantics that do not grant ambient
sockets. Add explicit capability-stream and plugin-output-object interfaces with credit, sequence,
size, sensitivity, cancellation and revocation. Generate exact worker modes and stream profiles for
all affected rows and reclassify anything that still requires an arbitrary listener/socket.

**`REVIEW-HERDR-CLOSE-006` — Closed**

The WIT host interface now exposes `worker-wait`, the complete open/read/write/wait-credit/close
stream path and create/append/commit/abort output-object path. `PLUG-WASI-019` through `-025` bind
wait, deadline, cancellation, generation, credit, size, cleanup and revocation semantics without
granting ambient sockets. The fixture materializes 19 resident, 31 event-driven and one scheduled
worker. All 42 stream profiles are referenced by operations and all 51 workers are bound to
declared operations and contributions.

### `REVIEW-HERDR-007` — High — The 59 build mappings have a schema but no executable per-row plan

**Original evidence (pre-closure)**

`source-build-plan-v2.schema.json` and `PLUG-INSTALL-026` through `-030` now define an appropriately
strict isolated Developer Source build mechanism. The Herdr mapping nevertheless records only a
build count and exact source commit. It supplies no source tree digest, builder image/tool digests,
pre-acquired dependency digests, argv steps, inputs/outputs, output artifact mapping or resource
limits for any of the 59 entries.

`PLUG-INSTALL-030` explicitly says a Herdr build is not inferred from a manifest shell string,
package script, Makefile or repository contents. Dynamic downloads, lifecycle scripts, host-tool
lookup and undeclared output require an author plan or are unsupported. Therefore
`HERDR-ARC-008` cannot transform a `B` count into a valid plan automatically.

**Original impact**

The 53 build-bearing repositories have not been shown buildable. Some may only be representable as
publisher-built immutable artifacts, some need an author-supplied plan, and some may require a
named Unsupported decision. Their current Supported labels cannot be derived from the evidence.

**Closure criterion**

For each build entry, record one of: published immutable artifact; complete validated Acorn build
plan; author-plan-required Developer Source path; or deliberate Unsupported/Extension disposition.
Generated plans must include exact tree/tool/dependency/output digests and pass the two-build
reproducibility rule. Recompute the 89/7/4 fit only after this classification.

**`REVIEW-HERDR-CLOSE-007` — Closed**

Every source build occurrence is now represented by exact manifest path, ordinal and source commit.
The 59 records resolve to 56 `developer-author-plan-required` dispositions with
`awaiting-author-plan` activation and three `unsupported` dispositions with a closed product
decision. No fixture infers a build plan from a shell string. A valid immutable plan remains subject
to the isolated builder and reproducibility rules before that optional Developer Source path can
activate. Reclassification still yields 89 Supported, seven Extension and four Unsupported rows.

### `REVIEW-HERDR-008` — High — Bespoke UI policy has no machine declaration for bridge authority

**Original evidence (pre-closure)**

The bespoke UI prose correctly requires a contribution to declare entrypoint, host surface, size
classes, view-session contract, bridge methods/events, classifications, guest features, semantic
fallback and mobile behavior. `UI-BESPOKE-PKG-006` makes those signed declarations security
critical.

The manifest can identify an artifact as `runtime: bespoke-ui`, but
`contribution-v2.schema.json` has no bespoke contribution kind or definition containing those
fields. A task pane or route can point at a local view ID, but no machine object binds that view to
the guest entrypoint and closed bridge method/event schemas.

The matrix offers signed bespoke UI for `HERDR-038`, `052`, `084`, `085`, `091` and `092`. A
semantic table/timeline fallback may preserve critical actions, but it does not preserve every
observed custom presentation, such as the pixel-art farm, and it does not repair the missing signed
bridge contract.

**Original impact**

Electron must invent how to discover and authorize the guest, or load it with no machine-declared
bridge. The first choice violates implementation completeness; the second weakens the sandbox.

**Closure criterion**

Add a closed bespoke-view contribution or a separately referenced signed bespoke-host schema with
all fields required by the prose. Cross-validate artifact/runtime/entrypoint, bridge schemas,
actions, view session, fallback, trust and platform. Provide positive and negative machine fixtures
and decide per affected Herdr row whether bespoke behavior is required or merely an optional
enhancement over a complete semantic implementation.

**`REVIEW-HERDR-CLOSE-008` — Closed**

`bespoke-view-v2.schema.json` supplies the signed host/entrypoint, unique-origin, view-session,
typed bridge, bounded authority and fallback contract. The positive bespoke fixture validates and
the arbitrary-network negative fixture is rejected. `HERDR-038`, `052`, `084`, `085`, `091` and
`092` explicitly classify bespoke presentation as an optional enhancement over a complete semantic
implementation. Their manifests therefore request no bespoke artifact or bridge authority, while
their renderer records preserve desktop behavior, accessibility, missing-capability handling and
semantic mobile fallback.

### `REVIEW-HERDR-009` — Medium — Keybinding and theme evidence is counted but not deterministically mapped

**Original evidence (pre-closure)**

The source corpus contains:

- `HERDR-019`: one legacy `prefix+shift+l` command binding;
- `HERDR-036`: one legacy `prefix+$` command binding;
- `HERDR-090`: two legacy command bindings;
- `HERDR-093`: three legacy command bindings; and
- `HERDR-065`: an eight-operation `keybindings` map plus `theme = "dark"`.

The matrix's supposedly exhaustive surface shorthand has no key/keybinding/theme field. Some row
representations generically mention “keybinding,” but `HERDR-090` and `HERDR-093` do not. More
importantly, `HERDR-065`'s arrows, Tab, Enter, Escape, `C-p` and `C-n` are intra-pane navigation
bindings, not necessarily Electron command shortcuts. The Acorn `keybinding` contribution dispatches
a host command, while standard semantic renderer keyboard behavior is host-owned. No expansion rule
decides whether these become host commands, renderer semantics, bespoke-guest keys or an intentional
behavior change. The plugin-local dark theme is likewise not dispositioned as local styling,
global appearance contribution or omission.

**Original impact**

The aggregate assertion is accurate but the per-plugin behavior can change silently. Treating an
intra-view keymap as global/pane-scoped commands can also create conflicts that the source plugin
did not have.

**Closure criterion**

Add key/keybinding/theme fields to the source-to-target ledger. For every declaration, record exact
target command/view behavior, scope, chord grammar, default conflict behavior, accessibility
alternative and mobile fallback. State whether the theme is required, transformed to semantic
tokens or deliberately omitted. Include these objects in the generated fixtures.

**`REVIEW-HERDR-CLOSE-009` — Closed**

The source ledger now records all 17 key entries and the one theme declaration. Seven legacy
command chords become host keybinding contributions bound to existing command contributions. The
ten `HERDR-065` intra-pane chords remain renderer-semantic behavior rather than global commands,
and its `dark` preference maps to client semantic theme tokens. Source-to-fixture comparison
reproduced every chord, command and disposition exactly.

## Escape-plugin results

| Adversarial design | Result | Boundary or gap |
| --- | --- | --- |
| Verified fixed TUI in a task pane with a brokered PTY | Representable | Native sandbox, exact process authority, PTY stream and Terminal renderer contracts are closed |
| Read-only Agent Fleet monitor with attention and notification | Representable | Agent snapshot/events, replay, attention, notification and node-qualified navigation are coherent |
| Worktree manager that creates/removes worktrees and then opens a task | Representable | Separate create/open/remove grants and operation-specific command/saga contracts prevent authority bleed |
| Contextual action palette and pane-scoped keybindings | Representable | Per-action operations, host chords and renderer-local semantics are explicitly distinguished |
| Regex link handler routing GitHub/GitLab/virtual links into a plugin pane | Safely constrained | Raw regex is rejected; the intended links use bounded typed templates and declared destinations |
| Startup hook restoring desired state | Representable or explicitly Unsupported | Installable hooks have worker/checkpoint descriptors; `HERDR-041` owns the closed Unsupported decision |
| Community resident worker consuming an external WebSocket | Safely constrained | Ambient sockets remain denied; brokered inputs and `worker-wait` cover safe cases, otherwise a named extension/product decision is required |
| Community event worker with local aggregation | Representable | Event worker, private storage, replay, redaction and exact grants are materialized |
| Plugin-owned high-volume log/export stream | Representable | WIT stream/object imports and manifest stream profiles enforce credit, size, cancellation and revocation |
| Credentialed notification/provider bridge | Representable | Opaque secret reference and destination/purpose-bound broker prevent plaintext exposure |
| Cross-plugin command with broader callee grant | Safely denied | Delegation-chain intersection and confused-deputy rules are explicit |
| Cross-plugin custom event used as authorization | Safely denied | Events are committed facts and authority is rechecked at command execution |
| Client-local recent-workspace navigator shared across multiple Clients | Safely device-scoped | Bounded presentation slices keep focus/history independent on each Electron device |
| Pixel-art or bespoke mission-control guest | Representable | Signed bespoke host/bridge schema exists; the six corpus candidates remain optional over semantic fallbacks |
| Plugin that installs another plugin | Deliberately unsupported | Core-only marketplace authority closes this escape |
| Source build that downloads dependencies or runs package lifecycle scripts | Deliberately unsupported by build policy | Every Herdr build occurrence now has an author-plan-required or Unsupported disposition |
| Native helper combining credentials, direct sockets, children and writable files | Safely denied | Toxic authority combination and raw-secret rules fail closed |

## Closure verification order

1. Coordinate regeneration and manifest validation passed (`REVIEW-HERDR-CLOSE-001`).
2. Capability-family, least-authority and client/Node ownership checks passed
   (`REVIEW-HERDR-CLOSE-003`, `-004`).
3. Navigation, WASI worker/stream and bespoke UI positive/negative checks passed
   (`REVIEW-HERDR-CLOSE-005`, `-006`, `-008`).
4. All 59 build occurrences have exact source binding and a closed disposition
   (`REVIEW-HERDR-CLOSE-007`).
5. The complete 100-row fixture and its cross-object references validate
   (`REVIEW-HERDR-CLOSE-002`).
6. All keymap/theme evidence has a deterministic disposition (`REVIEW-HERDR-CLOSE-009`).
7. Final arithmetic remains 89 Supported, seven Extension and four Unsupported.

## Final assertion

The source research, observed-surface inventory and machine expansion pass. The architecture
contains closed security boundaries for plugin isolation, delegated collaboration, credential
brokering, event semantics, client presentation ownership, native containment, bespoke UI and
core-only installation. It names the genuinely deferred relay/mobile, browser-driving,
window-title and provider-transform capabilities honestly.

**`REVIEW-HERDR-FINAL-001`:** Every repository in the frozen top-100 corpus is represented by a
schema-valid fixture or a closed Extension/Unsupported decision. Every source action, pane, event,
startup hook, link handler, build, keybinding and theme declaration has an exact disposition.
No tested adversarial composite requires undeclared authority or an implicit product extension.
`HERDR-ARC-025` and `HERDR-CLOSE-002` are verified. No Critical, High or Medium residual Herdr risk
remains.
