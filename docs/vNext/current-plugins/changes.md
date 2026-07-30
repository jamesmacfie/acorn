# Changes plugin migration

Status: **Normative**<br>
Coordinate: `acorn/changes`<br>
Requirement prefix: `CUR-CHG`

## 1. Current behavior and authoritative state

V1 presents uncommitted task-worktree changes as a PR-style file list and whole-file diff. It reads
Git status/diffs/blobs; stages, unstages, discards, commits and pushes; attaches inline review notes;
and sends file references or a single formatted review prompt to an agent. Git and the task
worktree are authoritative. `review_notes` is Acorn-owned SQLite state with
`path`, additions/deletions side, line range, snippet, body, `sentAt` and `createdAt`. Editing clears
`sentAt`; successful prompt delivery stamps it.

- **CUR-CHG-001:** V2 MUST preserve Git as authority and MUST NOT mirror repository content into the
  Changes database.
- **CUR-CHG-002:** Anchored review notes MUST move from core SQLite into the Changes plugin database.
  They remain distinct from Notes and provider review comments.

## 2. Current UI, routes, events, contributions and dependencies

V1 contributes pane `changes` (order 20, `meta+shift+g`, desktop), and an agent-tool renderer. It
uses GitHub's `DiffRows` and diff model directly, core task/worktree and agent-composer services, the
task dirty-status poll edge, and core review-note mutations.

V1 internal routes are task-scoped `local/{changes,diff,blob,stage,unstage,discard,commit,stage-all,
unstage-all,discard-all,push}` plus review-note list/create/edit/delete/sent. Its public `/api/v1`
surface exposes status, bounded diff/blob, stage, unstage, discard, commit and push. Patches/blobs
are capped at 5 MiB; Git receives argv, never shell-interpolated paths. No durable product events
exist; the pane refetches when dirty count changes.

## 3. Target classification

- **CUR-CHG-003:** Changes is a bundled **Acorn Verified** plugin, version-locked by the default
  installation profile. It is not a System plugin.
- **CUR-CHG-004:** Its shipped V2 Node artifact is a WASI Component for anchored-note and formatting
  policy. Git execution MUST be supplied by Node core's task-scoped Git capability. Its client
  contribution is declarative and uses standard diff/file renderers.
- **CUR-CHG-005:** Every supported Node platform selects the same platform-neutral
  WASI artifact digest. There is no declarative-only or native selection branch
  in V2. A future removal of the runtime is an independently versioned package
  change, not an implementer choice.

## 4. Node, Electron, native-host and renderer split

| Layer | Responsibility |
| --- | --- |
| Node core | Resolve task/worktree; confine paths; execute Git; provide status/diff/blob and durable dirty events; command idempotency |
| Changes Node component | Own anchored notes, review-prompt formatting and sent acknowledgement; expose Changes operations |
| Electron shell | Pane/layout/shortcut registration and agent-target picker |
| Standard renderers | `acorn.diff-review/2`, `acorn.file-tree/2`, forms, confirmation and status |

- **CUR-CHG-006:** Changes MUST NOT import GitHub diff code. `acorn.diff-review/2` is a client
  renderer owned by the Editor/client platform and accepts the common normalized diff model.
- **CUR-CHG-007:** The remote Node sends normalized diff data or a bounded diff object; it never
  sends renderer code. Large diff/blob payloads use content-addressed object transfer.

## 5. Manifest, capabilities, permissions and dependencies

The manifest contributes `task-pane changes`, keybinding, commands, context menus and the
`changes.review-notes` agent-tool renderer. Required capabilities are:

| Capability | Scope/reason |
| --- | --- |
| `acorn.task.read/1` | target Task metadata |
| `acorn.git.status/1`, `acorn.git.diff/1`, `acorn.git.blob/1` | task-scoped reads |
| `acorn.git.stage/1`, `unstage/1`, `commit/1`, `push/1` | explicit Git mutations |
| `acorn.git.discard/1` | destructive, separately approved |
| `acorn.agent.prompt.enqueue/1` | send review notes/file references |
| `acorn.storage.plugin/1` | anchored-note database |

It requires renderer capabilities `acorn.diff-review/2`, `acorn.file-tree/2`,
`acorn.form/2`; destructive confirmation is host-owned action chrome, not a renderer. It has an optional dependency on `acorn/agents >=2 <3`
for sending; review remains usable without Agents.

## 6. Queries, commands, capabilities, events and streams

| Contract | Kind | Result/fact |
| --- | --- | --- |
| `dev.acorn.changes.status.get.v1` | query | branch, ahead/behind, normalized staged/unstaged files |
| `dev.acorn.changes.diff.get.v1` | query | one path/scope normalized diff or object reference |
| `dev.acorn.changes.blob.get.v1` | query | bounded text/binary descriptor at approved ref |
| `dev.acorn.changes.notes.list.v1` | query | anchored notes ordered by creation |
| `dev.acorn.changes.stage.v1`, `unstage.v1` | command | selection `all` or bounded path set |
| `dev.acorn.changes.discard.v1` | command | paths/untracked policy; destructive confirmation |
| `dev.acorn.changes.commit.v1`, `push.v1` | command | commit SHA or push result |
| `dev.acorn.changes.note.create.v1`, `edit.v1`, `delete.v1` | command | revisioned anchored note |
| `dev.acorn.changes.review.send.v1` | command/saga | enqueue prompt, then mark exact notes sent |

- **CUR-CHG-008:** Events are `status.changed`, `note.created|edited|deleted|sent`,
  `commit.created` and `push.completed|failed` under `dev.acorn.changes.*.v1`. Status carries counts
  and affected relative paths only; it MUST NOT contain file bodies.
- **CUR-CHG-009:** `review.send` stores selected note revisions before agent enqueue. Only confirmed
  enqueue emits `note.sent`; edit racing with delivery leaves the newer revision unsent.
- **CUR-CHG-010:** Git commands use expected Task/worktree generation plus command idempotency.
  Multi-path failure MUST report whether paths partially changed and immediately refresh status;
  V2 MUST NOT falsely claim batch atomicity.

Changes defines no continuous stream. Diff/object download uses core object transfer.

## 7. UI contributions and renderer requirements

The pane MUST retain staged/unstaged groups, file status, selection, full-context unified diff,
syntax highlighting, inline note composer/annotations, Stage/Unstage/Discard, commit message,
Commit, Push, send-file reference, unsent-note count and Send review. Dirty-state changes refresh
without stealing selection/focus. Discard requires host destructive confirmation, not a two-click
button implemented inside plugin UI.

Missing diff renderer produces an explicit unsupported pane with status/command access disabled;
mobile fallback is a file/status list with note list, while line-level diff composition is
unsupported.

## 8. Storage, migration, backup, uninstall and reinstall

The plugin database owns `p_review_notes` with UUIDv7 ID, Task URI, path, side, start/end line,
snippet, body, sent revision/time, created/updated time, revision and tombstone. Unique/path indexes
are plugin-local. It is included in encrypted backup. Uninstall retains it 30 days; reinstall of the
same coordinate may adopt it.

- **CUR-CHG-011:** Clean V2 imports no V1 review notes. The V1 `review_notes` table remains untouched.
- **CUR-CHG-012:** Git status/diff/blob caches are ephemeral, capped and excluded from backup.

## 9. Setup, settings, health, update and failure

No wizard or credential is required. Settings cover diff whitespace/context preferences and default
push behavior only; destructive confirmation cannot be disabled below host policy. Health verifies
Git capability and renderer availability per Node/client. Missing worktree is a recoverable
`capability_unavailable`; invalid path/ref is validation failure; missing upstream is
`upstream_not_configured`. Update follows coordinated Node/client activation and must preserve
review-note schema.

## 10. Security and credential treatment

- **CUR-CHG-013:** Every path is normalized beneath the task worktree; absolute paths, traversal,
  symlink escape, option-like values and invalid Git refs are rejected before Git.
- **CUR-CHG-014:** Git credentials stay in Node Git/credential helpers. Changes never receives,
  stores or renders them.
- **CUR-CHG-015:** Diff/blob/note bodies are sensitive, excluded from logs/events and encrypted in
  backups. Commit messages and remote error output are bounded and sanitized.
- **CUR-CHG-016:** Discard and force-affecting operations require owner confirmation; arbitrary Git
  subcommands and caller-supplied cwd/environment are not exposed.

## 11. Coupling that must be removed

Remove direct Changes → GitHub renderer/model imports; core client review-note mutation imports;
direct task status and agent-composer singleton reads; and application wiring to Changes internals.
Replace them with standard diff renderer, declared events, V2 queries/commands and optional Agents
capability. Node core, not Terminal or Changes, owns generic Git/worktree execution.

## 12. Fresh-install parity scenarios

- **CUR-CHG-017:** A dirty Task opens the same Changes pane/shortcut, groups status identically,
  preserves selected file while events refresh, and renders equivalent whole-file syntax diff.
- **CUR-CHG-018:** Stage/unstage/all, commit and push produce the same repository result and visible
  errors; destructive discard requires stronger host confirmation.
- **CUR-CHG-019:** User can create/edit/delete inline notes, send all unsent notes to a selected idle
  agent, see queued/sent state, and see an edited sent note become unsent.
- **CUR-CHG-020:** Offline Node shows stale status and disables mutations; reconnect replays status
  or snapshots without duplicating a commit/send.
