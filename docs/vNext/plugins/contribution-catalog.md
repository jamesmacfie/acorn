# Contribution catalog

Status: Normative<br>
Requirement prefix: `PLUG-CONTRIB`

A contribution is signed declarative metadata that asks an Acorn host to expose a plugin feature.
It does not itself grant authority. The host validates every contribution, intersects it with
installation grants and negotiated renderer capabilities, and owns presentation and error
containment.

The [machine-valid contribution catalog](../contracts/examples/contribution-catalog.yaml) contains
exactly one positive fixture for every contribution kind in this document, including all three
worker modes. Negative semantic fixtures are required by the conformance rules below.

## Common contract

Every contribution contains:

| Field | Rule |
| --- | --- |
| `id` | stable plugin-namespaced identifier, 1–160 safe characters |
| `label` | 1–80 scalar accessible label |
| `description` | optional, 1–240 scalar explanation |
| `order` | signed 32-bit deterministic ordering hint |
| `when` | optional bounded context predicate |
| `requires` | optional dependency, grant and renderer requirements |
| `fallback` | optional fallback contribution or explicit unsupported state |

- **PLUG-CONTRIB-001:** Hosts MUST schema-validate contributions at install and again before
  activation. A failure disables the invalid contribution and fails activation when it is required.
- **PLUG-CONTRIB-002:** A contribution MUST NOT contain runtime functions, arbitrary HTML/CSS,
  JavaScript, database queries, unregistered URLs, or secret values.
- **PLUG-CONTRIB-003:** Predicates receive only documented host context and MUST be pure. Missing
  context evaluates false. Predicates cannot create an authorization decision.
- **PLUG-CONTRIB-004:** Host failure boundaries MUST identify the contribution and retain shell
  usability. Repeated render or action failures feed plugin health and quarantine.

## Catalog

| Kind | Host location | Required body | Missing-capability behavior |
| --- | --- | --- | --- |
| `fleet-source` | Fleet rail/navigation | icon, route, view | disabled row with reason |
| `workspace-source` | selected workspace rail | icon, route, view | hidden only when manifest says non-actionable |
| `task-pane` | flat task pane row/switcher | icon, view, min width, retention | preserved unavailable placeholder |
| `route` | Electron route table | path template, view, scope | unsupported route screen |
| `command` | palette/programmatic command | title, category, command target | disabled palette row |
| `keybinding` | shortcut dispatcher/settings | command, scope, default chord | command remains palette-accessible |
| `context-menu` | named host menu | command, group, selection types | item omitted |
| `shell-slot` | named shell slot | slot, view | bounded error marker or omission by slot policy |
| `task-slot` | named task slot | slot, view | quiet omission |
| `settings-page` | settings navigator | scope, schema/view | read-only unavailable page |
| `wizard` | modal setup runner | wizard definition | install/setup blocked |
| `notice-kind` | notice center/toast | severity, icon, toast policy | generic notice renderer |
| `notification` | notice center/toast instance mapping | event, severity, renderer | generic notice renderer |
| `attention-item` | Fleet attention inbox | event/query, actions | source marked stale |
| `badge` | supported host anchor | value binding, tone semantics | omitted with accessible host label intact |
| `poller` | Node scheduler, never browser timer | schedule, query/command | health degradation |
| `subscription` | view/background consumer | event declaration, handler/export | disconnected indicator |
| `background-worker` | supervised non-poll background operation | operation/events/health | degraded or blocked state |
| `query` | declared read operation | input/output schemas | unavailable data source |
| `action` | declared mutation operation | input/output schemas | disabled action with reason |
| `context-section` | agent context picker | snapshot query, budget, sensitivity | unavailable explanation |
| `agent-tool-renderer` | agent transcript | tool schema, semantic view | generic structured renderer |
| `navigation-intent` | brokered navigation | bounded templates, typed destination and captures | notification with copyable target |
| `client-presentation` | Electron-owned local state | local events, bounded slices and approved client automations | contribution disabled; Node state unaffected |
| `source-promotion` | source item to task | prepare/create/link commands | action disabled with reason |
| `renderer-provider` | Electron renderer registry | renderer ID, built-in implementation ID, accessibility/fallback contract | contribution remains unavailable; update Client action |
| `theme` | Electron appearance | token asset, label | default theme |
| `style` | Electron appearance | token asset, label, description | default style |

- **PLUG-CONTRIB-005:** Contribution kind names and field semantics are versioned host capabilities.
  A plugin MUST declare the required version for every kind it uses.
- **PLUG-CONTRIB-006:** `poller` runs on the Node supervised scheduler. It MUST declare minimum
  interval, jitter, timeout, overlap policy, visibility relevance, failure backoff, and command
  identity. Minimum interval is 5 seconds; the host MAY lengthen it.
- **PLUG-CONTRIB-007:** `subscription` is event-driven and preferred over polling. Reconnect uses the
  installation's durable event cursor; a renderer does not own a product-event cursor.
- **PLUG-CONTRIB-006A:** Every poller, subscription and background worker
  embeds one closed `worker-v2.schema.json` descriptor. Scheduled, event-driven
  and resident are distinct invocation modes; no null schedule or implicit
  `initialize` daemon is valid.
- **PLUG-CONTRIB-006B:** For WASI, scheduled/event workers use the corresponding
  WIT exports. A resident worker occupies a dedicated supervised component
  instance in `run-resident-worker`, signals readiness/heartbeat/checkpoint
  only through bound host imports and returns on drain/cancellation. Native
  workers implement the same messages over their authenticated framed IPC:
  `worker.start`, `worker.ready`, `worker.heartbeat`, `worker.checkpoint`,
  `worker.tick`, `worker.events`, `worker.drain`, `worker.stopped`.
- **PLUG-CONTRIB-006C:** Core owns clocks, tick/event IDs, cursors, overlap,
  deadline, backoff, checkpoint durability, resource admission, restart and
  quarantine. A clock jump does not replay a tick; duplicate IDs return the
  stored outcome. Update/revocation first stops admission, drains within the
  descriptor deadline, persists the last valid checkpoint, then terminates the
  full process/component tree.
- **PLUG-CONTRIB-008:** `theme` may supply palette tokens only; `style` may supply shape,
  typography, spacing, density, chrome and motion tokens only. The sets MUST remain disjoint and
  must not include executable stylesheets for declarative plugins.

## Fleet and workspace sources

- **PLUG-CONTRIB-009:** A Fleet source receives a Fleet projection containing Node descriptors,
  connection states and authorized aggregate resources. It MUST NOT infer authority from visibility.
- **PLUG-CONTRIB-010:** A workspace source is rendered only inside its owning Node/workspace scope.
  Its route MUST retain the canonical node-qualified workspace identity.
- **PLUG-CONTRIB-011:** Source promotion is a saga: validate source snapshot, create the target task
  on exactly one Node, add declared links, emit result events, and compensate created state when a
  required post-create step fails.

## Task panes and routes

- **PLUG-CONTRIB-012:** Task pane IDs are open namespaced strings. Unknown persisted IDs MUST remain
  in layouts as unavailable placeholders so reinstall can restore them.
- **PLUG-CONTRIB-013:** A task layout is a flat left-to-right row with unique pane IDs, positive
  finite weights and optional pins. Core owns show, add, close, pin, move, resize, equalize, focus,
  maximize and recipe replacement.
- **PLUG-CONTRIB-014:** `retention` is `none`, `session`, or `dom`. A plugin cannot demand permanent
  hidden DOM; the host may reduce retention under memory pressure and MUST signal view suspension.
- **PLUG-CONTRIB-014A:** A task pane that names `dataQuery` binds its initial and resynchronization
  document to that declared query operation. The returned semantic document opens a bounded view
  session under the ordinary patch/action contract. A pane without `dataQuery` MUST bind its data
  sources inside its signed UI document; a visible pane with neither binding fails activation.
- **PLUG-CONTRIB-015:** Routes MUST use host-provided route parameters and navigation intents.
  Contributions cannot install history listeners or navigate arbitrary external origins.
- **PLUG-CONTRIB-016:** A route collision with a core route or another active contribution is an
  install-time conflict. Static path segments outrank parameters; otherwise canonical ID order wins
  only for explicitly declared compatible route alternatives.

## Commands, keybindings, menus and intents

- **PLUG-CONTRIB-017:** A command contribution maps to one declared Node command, client-local
  presentation intent, or exported plugin capability. It MUST declare input acquisition, affected
  resource scope, repeatability, and whether owner confirmation is required.
- **PLUG-CONTRIB-018:** Command availability predicates affect presentation only. The command broker
  MUST reauthenticate, reauthorize, revalidate input, and check resource version at execution.
- **PLUG-CONTRIB-019:** Keybinding scopes are `global`, `fleet`, `workspace`, `task`, `pane`, and
  `typing-exempt`. The host owns conflict resolution, reserved chords, user override and accessibility.
- **PLUG-CONTRIB-020:** A default chord conflict leaves the later contribution unbound; it never
  steals an existing binding. The command remains discoverable in the palette.
- **PLUG-CONTRIB-021:** Navigation intents MUST be typed resource or presentation targets. External
  links use the host safe-navigation service and always expose the destination origin.
- **PLUG-CONTRIB-021A:** Navigation templates use a literal scheme and either a literal host with an
  optional literal or typed `{name:port}` port, or an authorityless custom-scheme path. Path
  segments use typed `{name:uuidv7|integer|slug|path-segment|path-tail}` captures. `port` accepts
  only integers 1–65535. `path-tail` is legal only as the final segment and consumes at most 16
  normalized path segments. Authorityless form is legal only for a manifest-owned, non-network
  scheme, uses exactly `scheme:/path`, and cannot be declared for `http`, `https`, `ws`, or `wss`.
  Templates are not regular expressions or globs. Scheme and host are ASCII-lowercased, default
  ports and dot segments are normalized, percent encoding is decoded once only after UTF-8
  validation, fragments are ignored, and a query is rejected unless its keys are explicitly
  allowlisted and typed as
  `uuidv7`, `integer`, `slug`, `path-segment`, or bounded base64url `opaque-token`. `acorn`, `file`,
  `javascript`, and `data` schemes are reserved and cannot be intercepted.
- **PLUG-CONTRIB-021B:** Matching is linear in at most 300 input characters, 16 templates,
  32 path segments and 16 captures. Exact scheme/host and the greatest number of literal path
  segments win. An equal-specificity overlap or collision with a core handler fails installation;
  runtime ambiguity fails closed to a copyable notification. The destination is exactly one
  node-qualified resource, declared client command, declared Node command with confirmation
  policy, or declared route contribution. Input mapping can pass typed captures and the fully
  normalized matched URI as `$target.uri`; it cannot pass the raw pre-normalization string.
- **PLUG-CONTRIB-021E:** Contract validation MUST prove
  [`navigation-regex-rejected.invalid.json`](../contracts/examples/navigation-regex-rejected.invalid.json)
  is rejected because its regex-like `template` is outside the literal/typed-capture grammar.
  Tests also cover typed port bounds, authorityless custom schemes, rejection of authorityless
  network schemes, equal-precedence overlap, reserved/foreign schemes, double encoding, invalid
  UTF-8, excess segments/captures/query keys and query-value smuggling.
- **PLUG-CONTRIB-021C:** A `client-presentation` contribution receives only the closed
  non-authoritative Electron events in its declaration. It may reduce them into at most 16
  installation-private slices, 1 MiB each and 256 entries each, using only host reducers. State is
  device-scoped, never enters Node settings, snapshots, events, backups or Fleet synchronization,
  and has no ordering relationship with the Node outbox.
- **PLUG-CONTRIB-021D:** Client presentation events are ordered by a per-client monotonic sequence
  for one running Client. Reconnect or restart begins a new epoch and supplies a complete current
  presentation snapshot before subsequent events. Disable freezes or clears according to the
  declaration; uninstall always clears. Declarative automations invoke only declared client
  commands, are debounced and require the declared owner approval. They cannot invoke a Node
  mutation except through the ordinary authenticated command contract.

## Slots, badges and notifications

Named shell slots are `topbar.left`, `topbar.right`, `fleet.rail`, `workspace.rail`,
`task.switcher.extra`, `task.footer`, `acorn.task.activity`, `tabrail.task-row`, `statusbar`, and
`overlay`.

- **PLUG-CONTRIB-022:** A slot contribution receives only the documented context for that slot.
  Callback-like behavior is expressed as action IDs, never host function references.
- **PLUG-CONTRIB-023:** Overlays MUST declare modality, focus return target, dismissal rules,
  stacking class and view-session lifetime. Plugins cannot exceed the host z-order class.
- **PLUG-CONTRIB-024:** Badges MUST have a text alternative and cannot communicate state by color
  alone. Numeric badges MUST declare aggregation, cap display and stale behavior.
- **PLUG-CONTRIB-025:** Notifications declare stable kind, severity, deduplication key, privacy
  class, expiration, toast eligibility, target navigation intent and actions. Plugin payloads cannot
  choose arbitrary renderer markup.
- **PLUG-CONTRIB-026:** Attention providers MUST support an authorized bounded snapshot plus durable
  incremental events. Cross-Node aggregation occurs in Electron and preserves Node identity.

## Settings and wizard contributions

- **PLUG-CONTRIB-027:** Settings pages and wizards MUST use the standard form/wizard renderer unless
  an independently signed bespoke UI contribution is explicitly selected.
- **PLUG-CONTRIB-028:** Settings definitions declare scope, precedence, default, validation,
  sensitivity, read/write authority, restart effect, and migration behavior.
- **PLUG-CONTRIB-029:** Wizard definitions use the state machine in
  [settings and setup wizards](./settings-and-setup-wizards.md); a contribution cannot replace
  permission prompts with bespoke content.

## Agent contributions

- **PLUG-CONTRIB-030:** A context section returns immutable snapshots with source, revision,
  captured time, byte/token budget, sensitivity, resource links and display summary. It does not
  give the agent live access to the source.
- **PLUG-CONTRIB-031:** Agent tool renderer matching is schema-coordinate based, not arbitrary code
  inspecting a tool payload. A semantic fallback MUST render the tool name, status and safely
  redacted structured input/output.
- **PLUG-CONTRIB-032:** Agent approvals are core-owned interaction types. A plugin can describe the
  requested operation and risk but cannot mark its own operation approved.

## Renderer providers

- **PLUG-CONTRIB-034:** A `renderer-provider` contribution can only activate an implementation
  already shipped in and allowlisted by the installed Electron Client. It cannot carry, download,
  evaluate or import JavaScript, native code, HTML or CSS into the application origin.
- **PLUG-CONTRIB-035:** System and Acorn Verified plugins MAY activate a standard provider.
  Community and Developer Source plugins MAY consume a negotiated renderer but cannot register a
  provider. The provider descriptor is signed, and its implementation ID, renderer major,
  minimum Client version, feature set, accessibility contract and fallback are validated locally.
- **PLUG-CONTRIB-036:** The V2 Electron build includes implementations for Editor's
  `acorn.code-editor/2`, `acorn.file-tree/2`, `acorn.search-results/2` and
  `acorn.diff-review/2`, and Preview's `acorn.browser-preview/2`. Installing those Verified plugins
  activates their descriptors; uninstalling them removes their contributions but does not permit
  replacement by untrusted executable code.
- **PLUG-CONTRIB-037:** `acorn.task.activity` is a host-composed task slot. Workflows, Agents and
  other declared providers contribute bounded activity items through semantic documents; no
  provider imports another provider's Client implementation or controls aggregate ordering.

## Acceptance

- **PLUG-CONTRIB-033:** The contribution host MUST have contract tests for every catalog row,
  including ordering, invalid predicates, absent capabilities, fallback, exception containment,
  accessible labeling, reinstall restoration, and authorization at the invoked boundary.
