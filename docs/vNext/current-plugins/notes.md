# Notes plugin migration

Status: **Normative**<br>
Coordinate: `acorn/notes`<br>
Requirement prefix: `CUR-NOTE`

## 1. Current behavior and authoritative state

V1 Notes is ephemeral working context at Task, Workspace and global scope. Truth is atomic Markdown
files under the local data root, with fixed frontmatter: title, author user/agent/workflow, kind
scratch/plan/finding/handoff, provenance, included and creation time. Task scratchpad is virtual
until first input. Included non-empty notes feed task Context. Agent writes/appends land directly
with server-stamped provenance.

- **CUR-NOTE-001:** V2 Notes MUST own its own service, plugin database/routes/events and UI. It MUST
  not be mounted through Memory or share a “knowledge bridge.”
- **CUR-NOTE-002:** Notes remain ephemeral Acorn state, distinct from committed Memory and anchored
  Changes review notes.

## 2. Current UI, routes, events, contributions and dependencies

V1 contributes desktop pane `notes` (order 30, `meta+shift+d`) and Notes context section indirectly.
The pane has Task scratchpad; grouped/filterable Task/Workspace/Global library; scope create;
agent/workflow badges; include toggle; rename/delete; Markdown edit/preview; 1.5-second body autosave;
and scoped retained open intent. It hides workflow seed notes represented in native sections.

Internal routes list/read/create/write/included/title/delete for Task and Workspace (`global`
reserved). Harness/MCP additionally list/read/write/append by Task. `/api/v1/plugins/notes` exposes
global/workspace/task CRUD with optimistic `expectedVersion`. V1 has no durable note events and
directly imports Context types for pane intent.

## 3. Target classification

- **CUR-NOTE-003:** Notes is bundled **Acorn Verified**, implemented as a WASI component with
  declarative UI and isolated plugin SQLite storage.
- **CUR-NOTE-004:** SQLite, not ad hoc Markdown files, becomes V2 durable authority so optimistic
  revisions and transactional events are exact. Markdown import/export remains an explicit feature,
  not the live store. This changes storage, not visual/behavioral parity.

## 4. Node, Electron, native-host and renderer split

Notes Node component owns scopes, CRUD, inclusion, provenance, context projection and Markdown
import/export. Electron owns draft editor state, debounce/flush and open intents. Standard
`acorn.code-editor/2` with language `markdown`, `acorn.markdown/2`,
`acorn.collection/2` and `acorn.form/2` provide UI; confirmation is host-owned. Core supplies
Task→Workspace authorization, plugin storage, agent tool invocation and events.

- **CUR-NOTE-005:** Client autosave includes expected note revision and an idempotent command ID.
  Switching/blur closes only after commit or shows conflict/recovery; it MUST NOT silently overwrite.
- **CUR-NOTE-006:** Agent author/session/task provenance is derived from authenticated delegated
  caller, never accepted from tool input.

## 5. Manifest, capabilities, permissions and dependencies

Required: plugin storage; task/workspace reads; agent tool export; context-section export; Markdown
renderer/editor. Optional dependency on `acorn/context` provides pane jump hosting, not data access.
Notes exports list/read/write/append capabilities to Agents, with write/append separate from human
UI grants.

Manifest contributes Task pane, keybinding, context section, agent tools, navigation intent
`notes.open`, notice kind for save conflict and Markdown export/import actions.

## 6. Queries, commands, capabilities, events and streams

Queries: `notes.list`, `note.get`, `context-section.get`; commands:
`note.create|replace|append|rename|set-included|delete`, `scope.export-markdown`,
`scope.import-markdown`. Location is exactly `{scope:global}` or `{scope:workspace,workspaceUri}` or
`{scope:task,taskUri}`. Note resource has UUIDv7/URI plus immutable slug, title, author, kind,
origin Agent/Task URIs, included, body, timestamps and revision. Slug is generated and remains stable
through rename.

Events are `note.created|body-replaced|appended|renamed|inclusion-changed|deleted` and
`scope.imported|exported`. Events contain URI/scope/title/kind/author/revision and body digest, not
body. Context invalidation subscribes to relevant note facts.

- **CUR-NOTE-007:** `replace`, rename and inclusion require `expectedRevision`; conflict returns
  current revision and preserves the user's local draft for explicit merge.
- **CUR-NOTE-008:** Append is idempotent by command ID and atomically advances revision once.
  Appended text max 64 KiB; total note body max 1 MiB; title max 200.
- **CUR-NOTE-009:** List ordering is updated descending; empty included notes are omitted from
  Context. Context budget remains 10 notes × 2,000 UTF-8 bytes, truncate-tail.
- **CUR-NOTE-010:** Notes defines no live stream. Import/export uses bounded object transfer.

## 7. UI contributions and renderer requirements

Preserve virtual Task scratchpad, three-scope grouped/filterable library, add-in-scope, stable
selection, provenance/kind/scope badges, include dot, rename/delete confirmation, sanitized Markdown
preview/edit, debounced autosave and retained scoped open intent. Workflow seed snapshots may be
hidden only through declared metadata, not slug guessing.

Mobile uses the same list/editor/preview; missing rich editor falls back to multiline text plus
sanitized preview. Save conflict provides compare/copy/reload/overwrite-with-new-revision choices;
overwrite is explicit.

## 8. Storage, migration, backup, uninstall and reinstall

Plugin DB `p_notes` owns ID, slug, scope kind/URI, title, author, kind, origin URIs, included, body
encrypted as sensitive, timestamps, revision and tombstone. Unique `(scopeKind,scopeUri,slug)`.
`p_imports` records provenance/digests. Notes are included in encrypted backup.

- **CUR-NOTE-011:** V2 clean-start imports no V1 data-root Markdown. V1 files remain unchanged.
  Owner may later explicitly import an exported V1 directory through the safe Markdown importer.
- **CUR-NOTE-012:** Disable preserves notes and hides contributions. Uninstall retains 30 days;
  delete-now and scope deletion are explicit. Reinstall same coordinate can adopt compatible data.

## 9. Setup, settings, health, update and failure

No initial wizard/credential. First import uses a resumable wizard showing scope, collisions,
provenance defaults and result. Settings control preview/edit default and autosave delay within host
bounds; inclusion is per note. Health is storage/context/renderer availability. An offline client
keeps an explicit local draft but does not queue silent writes; reconnect requires revision check.

## 10. Security and credential treatment

- **CUR-NOTE-013:** Bodies are sensitive; encrypted in plugin DB/backups and excluded from logs,
  events, search outside authorized scopes and client caches beyond protected offline policy.
- **CUR-NOTE-014:** Markdown is sanitized; raw HTML, script, remote image/resource loading,
  command links and executable code blocks receive no privilege.
- **CUR-NOTE-015:** Scope authorization is Node-derived. A Task caller may access that Task and
  owning Workspace/global notes according to the operation grant, never arbitrary URI strings.
- **CUR-NOTE-016:** Import rejects traversal, symlinks, oversized/archive-bomb input, invalid
  frontmatter and duplicate normalized slugs. Export contains no filesystem paths.
- **CUR-NOTE-017:** Agent writes are audited with delegated device/session identity and cannot
  spoof user/workflow authorship.

## 11. Coupling that must be removed

Remove Notes → Context model import; Notes store constructed/exported by Memory's `knowledgeIpc`;
core harness bridge over Notes implementation; core API route builders/mutations; and app scoped
eviction imports. Replace with Notes-owned service/database, manifest-declared routes/tools/context
section/navigation intent, durable events and plugin-owned client persistence.

## 12. Fresh-install parity scenarios

- **CUR-NOTE-018:** Opening Notes shows virtual Task scratchpad and equivalent grouped
  Task/Workspace/Global library; first typing creates once; autosave flushes on switch/blur/close.
- **CUR-NOTE-019:** Create, edit, rename, include/exclude and delete behave equivalently, including
  stable slug/deep link and provenance badges.
- **CUR-NOTE-020:** Agent list/read/write/append sees authorized scopes, stamps agent provenance and
  immediately invalidates Context without duplicate appends.
- **CUR-NOTE-021:** Context includes only non-empty/included/current-task-compatible notes at the
  same budget; remote clients edit the Node's Notes with conflict-safe revisions.
