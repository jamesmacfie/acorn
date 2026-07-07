# Inventories — the ground truth the phases operate on

**Status:** reference data · **Date:** 2026-07-07 (full code sweep) ·
**Consumer:** [implementation.md](./implementation.md) — each phase cites the
table it works through.

This file exists so no phase starts with "first, inventory the…". The
inventories below were taken from the code on the date above; they are
checklists, not estimates. When a phase consumes an entry, tick it off in the
PR; when the code moves, update the entry. If a number here disagrees with
prose elsewhere in docs/next, this file wins.

---

## 1. The IPC surface (Phase 3 consumes this)

**Totals: 67 `ipcMain.handle` channels + 3 `ipcMain.on` channels + 4 push
channels.** Classification: 65 req/resp (→ HTTP routes), 3 stream + 1 dynamic
push (→ the WebSocket), 2 Electron-isms + 2 window-targeted pings (stay IPC).

### 1a. Request/response channels by domain (→ HTTP routes)

| Domain | Channels (all in `main/`) | Count |
| --- | --- | --- |
| database (`database.ts:140-264`) | `db:connect` `db:tables` `db:columns` `db:rows` `db:query` `db:update` `db:insert` `db:delete` `db:disconnect` | 9 |
| local-git (`localGitIpc.ts:16-68`) | `local:changes` `local:diff` `local:blob` `local:stage` `local:unstage` `local:discard` `local:commit` `local:stageAll` `local:unstageAll` `local:discardAll` `local:push` | 11 |
| editor (`localGitIpc.ts:73-105`) | `editor:root` `editor:list` `editor:files` `editor:read` `editor:write` | 5 |
| knowledge (`knowledgeIpc.ts:172-258`) | `memory:list` `memory:search` `memory:add` `memory:proposals` `memory:proposal:resolve` `notes:list` `notes:read` `notes:create` `notes:write` `notes:setIncluded` `notes:remove` | 11 |
| run (`runIpc.ts:50-54`) | `run:targets` `run:start` `run:stop` `run:status` `run:defaultUrl` | 5 |
| search (`searchIpc.ts:70`) | `search:findInFiles` | 1 |
| workflow (`workflowWiring.ts:126-143`) | `workflow:defs` `workflow:start` `workflow:runs` `workflow:steps` `workflow:gate` | 5 |
| terminal control (`terminal.ts:433-623`) | `term:list` `term:profiles` `term:create` `term:sendToAgent` `term:kill` `term:interrupt` `term:remove` `term:resize` `term:previewUrl` `term:repoPath:get` `term:repoPath:set` `term:repoPath:runTargets` `term:task:statuses` `term:task:onCreated` `term:task:useCheckout` `term:task:archive` `mcp:inspect` `mcp:createStarter` | 18 |

### 1b. Stream channels (→ the WebSocket)

| Channel | Kind | Today |
| --- | --- | --- |
| `term:input` | `ipcMain.on` — keystrokes into a PTY | `terminal.ts:634` |
| `term:attach` / `term:detach` | `ipcMain.on` — subscribe/unsubscribe + ring replay | `terminal.ts:641,655` |
| `term:out:${id}` | dynamic per-session push (`ServerMsg` frames) | `terminal.ts:113,645-646` |
| `term:status` | push ping, no payload (session status changed) | `notify.ts:7` |
| `workflow:notice` | push `{taskId, kind, title}` | `notify.ts:13` |

WS framing must carry: `term:out` frames (coalesced ~16 ms), `term:input`,
attach/detach as messages or routes, the `term:status` + `workflow:notice`
pings, and (designed in from day one, populated later) `workflow:step:event`
live-tail frames ([agent-runtime.md](./agent-runtime.md) §3.2).

### 1c. Electron-ism residue (stays IPC, never HTTP — [security.md](./security.md) §3)

| Channel | Why it stays |
| --- | --- |
| `browser:bind` (`terminal.ts:460`) | takes a raw `webContents` id — a capability handle; HTTP exposure would hand out CDP control |
| `term:repoPath:pick` (`terminal.ts:535`) | native `dialog.showOpenDialog` |
| `acorn:close-pane` (`electron.ts:108`) | main→focused-window ping for ⌘W |

### 1d. What Phase 3 deletes when done

Preload namespaces on `window.acorn` (all of `preload.ts` except §1c):
`terminal` (+nested `repoPath`/`run`/`local`/`task`/`workflow`), `browser`
(keep), `mcp`, `memory`, `notes`, `editor`, `search`, `database`. Client
hand-declared interfaces: `terminalClient.ts` (also declares the `Window.acorn`
global incl. inline browser/mcp), `editorClient.ts`, `searchClient.ts`,
`notesClient.ts`, `memoryClient.ts`, `databaseClient.ts`;
`capabilities.ts` shrinks to probing the residue + the HTTP health check.

---

## 2. The server surface (Phases 0 and 2 consume this)

### 2a. Auth guards (Phase 0)

**56 inline `unauthenticated` sites** (55 `c.json({ error: 'unauthenticated' }, 401)`
+ 1 plain-object variant in `prContext.ts:14`). Every `/api` router repeats the
guard inline **except `harness.ts:93-96`**, which centralizes it in a
`.use('*')` middleware — the model `requireUser` generalizes. Worst offenders:
`workspaces.ts` ×12, `linear.ts` / `tasks.ts` / `reviewNotes.ts` ×5 each.
`authMiddleware` (`middleware/auth.ts`) only *attaches* `c.get('user')`; it
never enforces — enforcement is 100% per-route today.

### 2b. Error shapes (Phase 0)

**191 `c.json({ error … })` sites across 22 files.** Distinct shapes:
`{error}` (dominant), `{error, status}` (`prActions.ts:23`), `{error, detail}`
(`pullsBatch.ts:79`, `pullDetail.ts:76`), `{error, kind}` (harness-only,
`harness.ts:83,88`, `kind ∈ unavailable|not_found|bad_request|failed`).
Biggest files: `prActions.ts` ×44, `workspaces.ts` ×26, `linear.ts` ×20.
Confirmed upstream-prose leak: `prCreate.ts:122` returns GitHub's verbatim 422
message in the `error` field.

### 2c. Mappers lacking `satisfies` (Phase 0)

Only **9** `satisfies` sites exist (`workspaces.ts:92,222`,
`integrations.ts:29`, `rollbar.ts:88`, `linear.ts:134,146,152,164,209`).
Unchecked mappers to fix, highest traffic first:

| Mapper | Where | Feeds |
| --- | --- | --- |
| `toPublic` / `ghToPublic` | `routes/pulls.ts:211` / `:199` | `Pull` list rows |
| `toPublicPull` / `readComposite` / `toThread` | `routes/prMirror.ts:233/250/224` | `PullDetail` |
| `readFiles` | `routes/prMirror.ts:336` | `PullFile[]` |
| inline literal | `routes/me.ts:8` | `/api/me` (no type at all) |
| `toPublicRepo` / `readCachedRepos` | `routes/repoMirror.ts:29/26` | repo list |
| `toItem` | `routes/rollbar.ts:25` | `RollbarItem` |
| `nodeToDetail` / `toSummary` | `routes/linear.ts:87/107` | Linear detail/summary |
| inline compare/branches maps | `routes/prCreate.ts:70,86-98` | create-PR view |

### 2d. Serve-then-revalidate copies + TTLs (Phase 2)

State-machine sites to port: `pulls.ts:29-196` (decision block 178-195, ETag
304 handling 82-91), `pullDetail.ts:23-79` (45/65-71/73-78),
`pullFiles.ts:36-78` (60/69-73/75-77), `repos.ts:9-33` (21/24-27/30-32; POST
/refresh force at 34-40), `pullsBatch.ts:19-111` (per-resource `isFresh`
47-52). `linear.ts:156-242` and `rollbar.ts:49-121` are the variants that use
`issues.fetchedAt` **instead of `sync_state`** — the engine must support both
bookkeeping backends or (better) migrate them onto `sync_state` while porting.

TTL constants to centralize:

| Name | Value | Where | Exported |
| --- | --- | --- | --- |
| `STALE_AFTER_MS` | 45 s | `prMirror.ts:16` | yes |
| `STALE_AFTER_MS` | 45 s | `pulls.ts:14` | **no — duplicate decl, prime dedupe target** |
| `REPOS_STALE_AFTER_MS` | 300 s | `repoMirror.ts:8` | yes |
| `ITEMS_STALE_AFTER_MS` | 120 s | `rollbar.ts:15` | yes |
| `ISSUES_STALE_AFTER_MS` | 600 s | `linear.ts:24` | no |

(Out of scope for the cache-policy module: `SESSION_TTL_SECONDS`,
auth `STATE_TTL_SECONDS`.) `sync_state` keys are already centralized in
`db/resourceKeys.ts` (`pulls:` / `pr:` / `files:` prefixes); `etag` is only
ever populated by `pulls.ts` — the repos list leaves ETag savings on the table.

### 2e. Route test coverage (testing track)

Tested (8): `auth`, `pullsBatch`, `repoMirror`, `reviewNotes`, `rollbar`,
`taskContext`, `tasks`, `workspaces`. Untested (18): `actions`, `harness`,
`integrations`, `linear`, `me`, `mentions`, `pins`, `prActions` (44 error
sites!), `prContext`, `prCreate`, `prMirror`, `pullBlob`, `pullDetail`,
`pullFiles`, `pulls`, `repoLabels`, `repos`, `testDb`.

---

## 3. The client surface (Phases 5–6 consume this)

### 3a. Pref keys (Phase 6 — the `PrefKeys` const and the tier audit)

**20 keys.** Startup-restore keys (hydrated by the one-shot block or boot-time
effects in `App.tsx:174-238`): `theme_follow_system`, `theme`, `theme_light`,
`theme_dark`, `last_task`, `last_path`, `last_source`, `task_layouts`,
`task_panes` (legacy read-only fallback), `notices`, `editor_open_files`,
`pr_filters`, `left_collapsed` (reactive seed; also the one persist effect
that *does* invalidate `prefsKey` — `App.tsx:285` — the protocol
contradiction Phase 6 unifies). Reactive-read keys (no restore phase):
`pane_shortcuts`, `diff_view`, `rail_order`, `term_rail_default`,
`term_height`, `onboarded`.

### 3b. Keydown listeners (Phase 5 — the dispatcher collapses these)

13 `window.addEventListener('keydown')` sites; no keyup. Global chords:
`App.tsx:66` (⌘, settings), `App.tsx:98` (⌘⇧⏎ drawer, capture-phase),
`TabRail.tsx:136` (⌘⇧N, ⌘0, ⌘1-9), `TaskView.tsx:168` (pane chords via
`paneKeymap`), `TerminalPanel.tsx:135` (⌘⇧[/], ⌘⇧1-9), `overlay.ts:104`
(⌘K/⌘P/⌘L + open-palette keys, capture + stopPropagation to beat Monaco),
`PullList.tsx:69` (bare j/k, typing-guarded), `DiffView.tsx:292` (⌘F).
Esc-close locals (stay component-local per §4.4's focus-semantics carve-out):
`Picker.tsx:78`, `AccountMenu.tsx:30`, `ChecksPanel.tsx:85`,
`LinearIssuePanel.tsx:43`. Current conflict-avoidance is *conventions*:
TabRail ⌘digit bails on Shift so TerminalPanel can own ⌘⇧digit; overlay uses
capture to pre-empt Monaco — the registry must reproduce both semantics
(capture-phase pre-emption and modifier-disambiguation), not just the table.

### 3c. Module-scope keyed collections (Phase 6 — eviction subscribers)

No archive eviction today except `previewWebviews`:

| Collection | Where | Key | Eviction today |
| --- | --- | --- | --- |
| `viewByWorkspace` | `tasks.ts:22` | workspace | none |
| `taskLayouts` | `tasks.ts:35` | task | none |
| `recipeBrowserUrls` | `tasks.ts:59` | task | none |
| `terminalOpenTasks` / `terminalMaxTasks` | `tasks.ts:67/82` | task | toggle-only |
| `activeByTask` | `sessions.ts:32` | task | none |
| `editorStateByTask` | `editorState.ts:45` | task | none (persisted) |
| `prFilters` | `filterState.ts:9` | workspace | none (persisted) |
| `viewStates` (Monaco) | `EditorPane.tsx:26` | `task:path` | none |
| `previewWebviews` | `PreviewPane.tsx:28` | task | manual, 3 call sites |
| `statuses` | `taskStatus.ts:10` | task | self-prunes per poll |

### 3d. Panes (Phase 5 — the registry replaces these)

`PaneId` union has **10** members (`layout.ts:9`): `pr linear rollbar preview
editor changes notes context database search`. Parallel hand-synced lists:
`PANE_LABELS` (`layout.ts:22-33`), `PANE_ORDER` (`:37`), `PANE_IDS` (`:42`),
`PANE_SHORTCUT_DEFAULTS` (`paneShortcuts.ts:14-27`, 12 entries — panes + the
`agents`/`terminal` extras), `RESERVED_CHORDS` (`:32-35`). `paneBody()` ladder:
`TaskView.tsx:233-285`; switcher buttons: `TaskView.tsx:301-340`. (Several
older docs say 8 or 9 panes; the code says 10.)

Pane-management baseline for ux §7 / implementation Phase 5: task panes are
equal-width CSS slots today (`task-view.css:215`, `flex: 1 1 0`); `TaskLayout`
has no persisted size/weight field (`layout.ts:11-13`); the reducer still
normalizes a legacy `{ active, pinned[] }` shape (`layout.ts:70-82`) but the
runtime no longer exposes pinning; maximize exists only for the terminal drawer
(`App.tsx:79-100`, `tasks.ts:80-92`), not for task panes. The Phase 5 model is
id-keyed weights + `pinned[]` in `task_layouts`, with maximize remaining
session-only.

### 3e. Command palette hardcoded actions (Phase 5)

`CommandPalette.tsx:63-80`: `new-terminal`, `new-claude`, `new-codex`,
`toggle-terminal`, `pane-<id>` ×10 (derived), `pane-close-<id>` (derived),
`archive`. Dynamic rows already provider-shaped via `composeItems`
(`:99-106`): tasks, workspaces, run targets, workflows, recipes, config
errors. Invocation switch: `:172-205`.

### 3f. One-shot mailbox signals (Phase 5 — `ctx.events` / `openPane(id, intent)` replace all four)

| Mailbox | Writer → reader |
| --- | --- |
| `pendingTerminalFocus` (`sessions.ts:41-46`) | CommandPalette `:177,184,191` → TerminalPanel `:99` |
| `FILE_SCROLL_EVENT` CustomEvent (`fileNavigation.ts:1,13`) | `emitFileScroll` callers → DiffView `:457` |
| `noteToOpen` (`notesClient.ts:28-31`) | ContextPane `:45` → NotesPane `:62-66` |
| `pendingEditorReveal` (`editorState.ts:68-73`) | Search pane → EditorPane |

(The last two were not in review.md — the pattern is four instances, not two.)

### 3g. `window.alert` / `confirm` sites (Phase 5 — one error surface)

**25 sites** across 15 files — not just ChangesPane. alerts (19):
`TabRail.tsx:144`, `TaskView.tsx:84`, `RollbarBrowse.tsx:69,72`,
`MemoryTray.tsx:30`, `ChangesPane.tsx:71,111,128,143`, `AgentsPanel.tsx:73`,
`WorkspaceRepoAssignments.tsx:66`, `NotesPane.tsx:74,84,92,103`,
`EditorPane.tsx:267`, `CommandPalette.tsx:153,168,200`. confirms (6):
`WorkspaceSettings.tsx:112`, `DatabasePane.tsx:280`, `ChangesPane.tsx:116,122`,
`NotesPane.tsx:110`, `CommandPalette.tsx:198` — the confirms are will-phase
candidates (destructive), the alerts split into inline-signal (foreground) or
notice (background) per [ui-state.md](./ui-state.md) §3 rule 1.

### 3h. Polling sites (perf §3.2 pauses these; `ctx.poll` later subsumes)

`taskStatus.ts:28` (5 s), `AgentsPanel.tsx:45` (3 s), `queries.ts:120`
(60 s `refetchInterval`), `index.tsx:26` (`refetchOnWindowFocus: true`
global), plus main's idle watch (`terminal.ts:242-254`, 3 s — main-side, not
visibility-pausable, but boundable).
