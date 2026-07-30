# Editor verified plugin

**Status:** Normative current-plugin migration<br>
**Coordinate:** `acorn/editor`<br>
**Distribution:** Acorn Verified; independently versioned and installed by the default profile<br>
**Runtime:** WASI Node companion plus declarative `renderer-provider` contributions<br>
**Requirement prefix:** `CUR-EDITOR`

Editor supplies Acorn's file tree, quick file picker, code editor and find-in-files surface. Its
signed `renderer-provider` contributions activate the Electron-built-in
`acorn.code-editor/2`, `acorn.file-tree/2`, `acorn.search-results/2` and
`acorn.diff-review/2` implementations already allowlisted by that Client build. It does not own
task/worktree identity, generic filesystem authority, Git, process execution, agent sessions, pane
layout, Electron native APIs or executable Client code.

This specification is divided into:

- [Node and data](./node-and-data.md)
- [Client and UI](./client-and-ui.md)
- [Contracts, events, and security](./contracts-events-and-security.md)
- [Migration and parity](./migration-and-parity.md)

The mandatory twelve-section template is distributed without omission: sections 1–3 and 9 are in
this overview; sections 4 and 8 are in Node/data plus Client/UI; sections 5–6 and 10 are in
Contracts/events/security; section 7 is in Client/UI; and sections 11–12 are in Migration/parity.

## Current behavior and authority

V1 resolves a task to its checkout, lists directories lazily, enumerates tracked and non-ignored
untracked files with `git ls-files`, reads and writes UTF-8 text, and searches the worktree with the
bundled ripgrep binary. The Electron renderer supplies two task panes (`editor` and `search`), a
`Cmd+P` overlay, Monaco models, autosave, persisted open tabs, session-only tree/view state, and
typed reveal intents. Search results open the Editor beside Search. A selected editor range may be
sent to the task Agent composer.

V1 has two HTTP surfaces over the same bridge: task-scoped in-app routes and `/api/v1` automation
endpoints. The latter hashes file content for optimistic writes, while the in-app autosave route
does not. V2 replaces both with one versioned contract and never permits an unconditional overwrite.

`CUR-EDITOR-001` Editor MUST be an independently installable Acorn Verified package, but the
default profile MUST install its compatible Node and declarative Client artifacts before first
task display.

`CUR-EDITOR-002` The Editor Node companion MUST consume task-scoped core file, repository and
search capabilities. It MUST NOT receive an absolute checkout path from a Client or open the core
database.

`CUR-EDITOR-003` Editor's signed renderer-provider declarations MUST activate the four standard
renderer capabilities and Editor/Search product contributions only after manifest, compatibility,
grants and Node counterpart have been verified. The declarations can select only implementations
already shipped and allowlisted by the Electron build.

`CUR-EDITOR-004` Renderer registration MUST NOT grant file authority. Every tree, read, search and
write operation is authorized independently on the owning Node against the canonical task.

`CUR-EDITOR-005` Monaco, its language workers, ripgrep and Git are implementation details. Plugin
and view contracts use semantic renderer, file, search and revision types.

## Target ownership

| Concern | V2 owner |
| --- | --- |
| Node/task/workspace identity and worktree root | Node core |
| Rooted file read/write/watch and repository enumeration | core file/repository broker |
| Search request normalization and result projection | Editor Node companion |
| Git-backed tracked/untracked enumeration | core repository capability |
| Editor, tree, search and diff renderer implementations | allowlisted Electron built-ins activated by Editor |
| Pane layout, palette host and reveal navigation | Electron core |
| Open tabs, dirty buffers, cursor, selection and expanded tree | Electron Client state |
| Durable file bytes and revisions | task worktree/core file resources |
| Agent reference insertion | optional Agents capability |

`CUR-EDITOR-006` Editor MUST NOT create a plugin database for repository file content. The
worktree remains authoritative and no file body is copied into plugin persistence or product
events.

`CUR-EDITOR-007` Open-tab metadata is Client-device presentation state. Dirty buffers are
session-local sensitive state and MUST NOT be sent to a Node, backup, event log, or another Client
until the owner saves.

`CUR-EDITOR-008` A headless Node requires no Client implementation. Its query/command surface
continues to operate; a Client without compatible allowlisted renderers shows the declared
read-only metadata or unsupported-client fallback.

## Manifest and contribution summary

The manifest declares:

- WASI Node runtime and declarative schemas;
- signed declarative renderer-provider contributions activating `acorn.code-editor/2`,
  `acorn.file-tree/2`, `acorn.search-results/2` and `acorn.diff-review/2`;
- `editor` and `search` task panes, `files` overlay, commands, keybindings, context menus,
  navigation intents, queries and actions;
- required core task/file/repository/storage/event/UI contracts;
- optional `acorn/agents` reference-insert and diagnostic-provider dependencies; and
- no wizard, secret, background worker, arbitrary network or native-process artifact.

`CUR-EDITOR-009` Required grants are `core.task:read`, task-rooted `core.file:read`,
task-rooted `core.file:code-write`, `core.repository:status`, bounded fixed-tool repository search,
declared `core.ui` contributions, own health, and declared event subscription. The package requests
no network, secret, PTY, terminal, arbitrary process, clipboard-read, or raw path capability.

`CUR-EDITOR-010` The fixed-tool search grant permits only the host search primitive with bounded
query/options/deadline/output. It does not grant a general `rg` or shell process.

`CUR-EDITOR-011` The optional Agents dependency enables only `acorn/agents`' typed
`reference.insert@2` capability. Denial or absence hides the “→ agent” action without degrading
editing.

## Activation, health and clean start

`CUR-EDITOR-012` Activation verifies renderer majors, allowlisting and limits, registers contributions
atomically, tests a brokered no-content file query, and reports Node and Client health separately.
It does not require an open task or mapped repository.

`CUR-EDITOR-013` Editor has no setup wizard and no secrets. Its empty state is a ready pane that
asks the owner to select a task or establish that task's checkout through core task recovery.

`CUR-EDITOR-014` A Node-side failure leaves the panes and tabs visible as unavailable/stale
placeholders with retry and diagnostics. A built-in Client-renderer failure leaves all other panes
and the Node usable and reports that Electron capability unhealthy without accepting replacement
code from the plugin.

`CUR-EDITOR-015` Uninstall is permitted outside the default profile. It removes contributions and
Client presentation state after a dirty-buffer confirmation; it never deletes or modifies
worktree files. Reinstall restores inert layout pane IDs but not discarded dirty text.

`CUR-EDITOR-016` Updates coordinate Node/declaration compatibility with the installed Electron
capability set and preserve compatible Client metadata. A failed provider or Node health gate
atomically rolls back the plugin generation; no file or Electron-code migration is involved.

## Compatibility invariants

`CUR-EDITOR-017` Every file reference uses a canonical node-qualified file resource plus
worktree-relative normalized path. Absolute paths are display-redacted and never cross the Node
boundary.

`CUR-EDITOR-018` All writes use expected revision/content hash and fail with `conflict` when the
disk changed. Autosave never silently overwrites agent, tool, Git or external-editor changes.

`CUR-EDITOR-019` The exact fresh-install parity and failure cases in
[Migration and parity](./migration-and-parity.md) are release requirements.
