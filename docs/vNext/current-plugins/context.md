# Context plugin migration

Status: **Normative**<br>
Coordinate: `acorn/context`<br>
Requirement prefix: `CUR-CTX`

## 1. Current behavior and authoritative state

V1 Context is an assembly and presentation surface, not a knowledge store. It composes task facts,
PR summary/files, linked integration items, included task/workspace/global Notes and the repo Memory
index. Each section declares label, default inclusion, byte budget, overflow policy, assembler,
compact formatter and optional jump. The client persists per-task inclusion and selected agent;
sync fingerprints report never/synced/stale.

- **CUR-CTX-001:** V2 Context MUST remain a projection. It MUST NOT own Notes, Memory, provider
  records, PRs, agent sessions or duplicated content.
- **CUR-CTX-002:** The exact immutable context snapshot sent/attached to an agent is an Agents-owned
  artifact with Context provenance; editable selection and preview are client-owned.

## 2. Current UI, routes, events, contributions and dependencies

V1 contributes pane `context` (order 40, `meta+shift+x`) and agent context source
`context.task`. `GET /api/tasks/:id/context?include=*|ids` returns `TaskContext`. The pane shows
section include toggles, items, origin/scope badges, byte/~token bars, absent/omitted markers,
expandable details, exact compact preview, target-agent picker and Sync Context. Pane intents reveal
Context rows or jump to Notes/provider panes.

V1 hard-wires PR/issues/Notes/Memory assemblers in core, imports `MemorySection` and Notes client
directly, reads Agent/Terminal session globals, and uses client-only revision/sync stores. No durable
Context event exists.

## 3. Target classification

- **CUR-CTX-003:** Context is a bundled **Acorn Verified**, declarative-first plugin. It has no
  native process and needs no direct filesystem, database, provider or credential authority.
- **CUR-CTX-004:** Node core owns the context-section registry, deterministic budget engine and
  snapshot command because these are cross-plugin and agent-facing platform contracts. Context
  contributes the default pane, selection UX and capture adapter.

## 4. Node, Electron, native-host and renderer split

| Layer | Responsibility |
| --- | --- |
| Node core | Register/authorize section exports; obtain independent section projections; apply budgets; return one snapshot sequence |
| Context Node policy | Default contribution ordering, labels and compact document request |
| Electron | Persist selection, expansion, target agent and sync fingerprints; merge pane intents |
| Renderers | tree/list, checkbox, status/budget, Markdown preview, picker and attention |

- **CUR-CTX-005:** A section is assembled independently of sibling inclusion. Its compact bytes MUST
  not vary based on other selected sections, preserving single-fetch byte-exact preview.
- **CUR-CTX-006:** Node returns semantic section data and compact text; Electron never re-fetches
  private plugin endpoints or reads plugin stores.

## 5. Manifest, capabilities, permissions and dependencies

Context contributes `task-pane context`, keybinding, agent context source, navigation intent
`context.reveal`, and commands `refresh`, `capture` and `send`.

Required capabilities are `acorn.task.read/1`, `acorn.context.sections.query/1`,
`acorn.context.snapshot.create/1`, and standard renderers. `acorn.agent.prompt.enqueue/1` is optional
through dependency `acorn/agents >=2 <3`. Optional dependencies `acorn/notes` and `acorn/memory`
name their exported section capabilities/events. Provider/GitHub sections are discovered through
core section registration, not plugin imports.

- **CUR-CTX-007:** Absence of an optional plugin removes or marks only its section; it MUST NOT
  prevent Context activation.
- **CUR-CTX-008:** Section subscription requires declared dependency or a core event capability;
  receipt does not grant access to section bodies.

## 6. Queries, commands, capabilities, events and streams

`dev.acorn.context.inventory.get.v1` accepts Task URI and optional section IDs and returns Task
summary, `snapshotSequence`, and ordered sections:

`{id,provider,label,defaultIncluded,budget,items,compact,omitted,absent,revision,sensitivity}`.
Items are `{id,kind,label,body?,details?,origin?,navigationIntent?}`. Budget overflow is
`truncate-tail|index-only|omit-with-marker`; truncation is UTF-8-byte safe.

`dev.acorn.context.snapshot.create.v1` stores the exact selected compact blocks plus resource and
section revisions as an immutable Agents attachment. `dev.acorn.context.send.v1` enqueues that
artifact to one agent session at the `after-ready` edge. Context exports
`dev.acorn.context.selection.capture.v1` for Agents' context picker.

Events:

- `dev.acorn.context.section.invalidated.v1` with Task/section/revision only;
- `dev.acorn.context.snapshot.created.v1` with artifact metadata, never body;
- `dev.acorn.context.send.queued|delivered|failed.v1`; and
- client-local presentation events for reveal/focus, not Node product events.

- **CUR-CTX-009:** Refresh fans out section queries concurrently with per-section 3-second deadlines
  and 10-second aggregate deadline. Failure returns the last authorized section as stale when
  available plus an `absent` reason; one failure does not erase siblings.
- **CUR-CTX-010:** Inventory response is capped at 1 MiB, 64 sections, 100 items/section, 32 KiB/item
  and 256 KiB compact total. Each contribution may declare stricter limits.
- **CUR-CTX-011:** Context defines no continuous stream. Agent delivery status uses durable events.

## 7. UI contributions and renderer requirements

Desktop parity requires header summary, hidden empty sections except Memory, checkbox selection,
per-section byte/~token indicator and budget bar, origin/scope badges, expandable details, edit/jump
actions, omitted/incomplete text, exact preview, target session picker, sync status, refresh and Sync
Context. `~tokens=ceil(bytes/4)` is explicitly an estimate.

Mobile maps to the same semantic list/preview with one-column navigation. Unsupported section
renderer shows a bounded generic label/details view. A section's sensitivity controls copying and
attachment warnings.

## 8. Storage, migration, backup, uninstall and reinstall

Context has no Node domain database beyond plugin lifecycle metadata. Electron stores per-device
`(nodeId,taskUri)` selection, expansion, last target and per-session section-digest sync record.
These are presentation preferences, excluded from Node backup and safe to discard.

- **CUR-CTX-012:** Clean V2 imports no V1 local selection/sync state.
- **CUR-CTX-013:** Removing Context deletes local presentation state but never deletes section
  providers or Agents artifacts already created.

## 9. Setup, settings, health, update and failure

No setup wizard or secret is required. Settings expose default selected section IDs and context
injection preference at owner/Node/workspace scopes; plugin defaults are PR false, linked issues
true, Notes true and Memory false. Per-task client selection overrides defaults after first change.
Health reports core section registry compatibility and optional provider degradation.

Update changing budgets/format must version the section/snapshot schema. Existing immutable agent
snapshots retain their original content/digest.

## 10. Security and credential treatment

- **CUR-CTX-014:** Context receives only already-authorized, redacted projections. It MUST NOT
  receive provider tokens, secret refs, HTTP headers, terminal output, raw database rows or paths
  beyond authorized display metadata.
- **CUR-CTX-015:** Section sensitivity propagates to the aggregate at the strictest level.
  Sensitive bodies are excluded from logs/events and encrypted in Agents artifacts/backups.
- **CUR-CTX-016:** Compact formatter is data-only: no HTML, script, template execution, remote
  fetch, arbitrary renderer, or cross-section query.
- **CUR-CTX-017:** Agent send requires explicit owner action or an independently configured,
  audited launch-injection policy. Merely opening Context cannot transmit data.

## 11. Coupling that must be removed

Remove Context → Memory component, Context → Notes client, app persisted-slice imports, direct agent
session/terminal stores, and core's construction from concrete Notes/Memory implementations. Replace
with registered section capability exports, standard Memory proposal contribution, navigation
intents, Agents capabilities and client contribution-owned persistence.

## 12. Fresh-install parity scenarios

- **CUR-CTX-018:** Existing PR/issues/Notes/Memory sections, defaults, order, budgets, omitted/absent
  markers and exact compact preview match V1 for equivalent data.
- **CUR-CTX-019:** Selection survives pane close/restart on that Electron device; refresh preserves
  it; section changes mark prior session sync stale.
- **CUR-CTX-020:** Reveal intents open/scroll the correct row and Notes edit jumps retain
  task/workspace/global scope.
- **CUR-CTX-021:** Sync sends once immediately or queues once until idle, reports the selected agent,
  and a retry with the same command ID cannot duplicate the prompt.
