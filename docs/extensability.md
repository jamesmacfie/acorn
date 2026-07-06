# acorn as a plugin platform

**Status:** design proposal · **Date:** 2026-07-07 · **Companion:** [review.md](./review.md)

This doc answers one question: *if everything in acorn were a plugin modifying an
extendable core, what would that core be, what extension points would it expose,
and can that model reach 100% parity with what ships today?*

It is grounded in a full inventory of what every pane and shell surface actually
consumes (routes, IPC channels, main-process modules, prefs, shortcuts, palette
entries, context contributions, lifecycle obligations). The parity map in §7 is
the proof obligation: every current feature is expressed as a plugin over the
contribution points in §4, or explicitly kept in core with a reason.

---

## 1. Design tenets

1. **The core owns mechanism; plugins own policy.** The core knows how to render
   a pane, sync a mirrored resource, spawn a PTY, register an MCP tool, persist a
   pref. It does not know what a "PR" or a "Linear issue" is.
2. **Contribution points are declarative data; hooks are imperative
   subscriptions.** A plugin *declares* panes, commands, tools, and settings pages
   as typed objects the core's registries consume. It *subscribes* to lifecycle
   events (task archived, session status changed) and returns disposables. Static
   things stay static so the core can index, list, and conflict-check them.
3. **A plugin spans processes.** acorn's features live in three runtimes (renderer,
   Hono server, Electron main) plus the MCP stdio process. A feature like
   "preview" is one plugin with a client part and a main part — not three
   fragments coordinated by convention. The plugin unit is the *feature*, not the
   process.
4. **Declare an agent capability once.** Today one agent verb costs five edit
   sites (preload, IPC, harness route, bridge, MCP tool — review.md §1d). In the
   plugin model a tool is declared once and the core *projects* it to MCP, to a
   harness HTTP route, and (optionally) to a typed renderer client.
5. **Trusted, in-tree, compiled-in.** This is an architecture for *this* codebase,
   not a marketplace. Plugins are TypeScript modules in the repo, type-checked
   against the core API, loaded by a static registry. No sandboxing, no dynamic
   loading, no version negotiation. (A dynamic loader can be layered on later —
   nothing below precludes it — but designing for hostile third-party code now
   would tax every interface for a user that doesn't exist.)
6. **Unknown contributions degrade, never crash.** The codebase already has the
   right instinct (`isPaneId` filtering persisted layouts, `availableSources`
   hiding unconnected providers). Generalize it: persisted state referencing a
   pane/source/command from a disabled plugin is retained but inert.
7. **IDs are namespaced strings.** `github.pr-pane`, `linear.issue-pane`,
   `core.terminal-drawer`. The closed unions (`PaneId`, `SourceId`,
   `WorkflowStepDef.kind`) that today leak into 18 files become registry-validated
   strings with branded types at the edges.

---

## 2. The core (what is *not* a plugin)

The core is the part that would remain if you deleted every feature. It is
deliberately boring: identity, storage, process plumbing, and empty UI sockets.

### 2.1 Client core

- **The shell**: window chrome, auth gate, the region layout (top bar, left rail,
  main area, bottom drawer socket, right panel socket, overlay layer) — each
  region exposing **slots** (§3.3) that plugins fill. Today's `App.tsx` is the
  shell *plus* ten features fused together; the core shell is App.tsx with the
  features extracted.
- **The Workspace → Task model and stores**: `tasks`, `taskLinks`, workspace
  membership, the active-task/selected-source signals, the layout reducer
  `applyLayoutAction` (kept verbatim — it's already pure and pane-agnostic; only
  `PaneId` widens from a union to validated strings).
- **The data layer**: the TanStack Query client, IndexedDB persistence, the
  `readJson`/`writeJson` client, and the **prefs service** (namespaced key-value
  with hydrate-once/persist semantics — the ordered startup-restore pipeline from
  review.md §4 becomes a core service plugins register slices into, instead of
  effects hand-ordered in App.tsx).
- **Registries + the event bus** (§3).
- **Capability detection**: `desktop` / bridge-present flags; plugins declare
  which capabilities their parts require and the core gates activation.

### 2.2 Server core

- The Hono `createApp()` factory, session (encrypted cookie, OAuth flow),
  CSRF/host-guard middleware, the Drizzle/SQLite connection, migrations, the
  prefs routes, and the **sync engine** — the serve-then-revalidate state machine
  (TTL + ETag + atomic delete-then-insert via `db.batch`) extracted once (this is
  review.md recommendation #2, promoted to a core service that source plugins
  configure with resource descriptors, §4.9).
- The **harness gateway**: tool-route projection, `INTERNAL_TOKEN` auth, the
  single `respond()` error envelope.
- GitHub *authentication* stays core (it is the app's identity provider — the
  session's `user_id` is the GitHub login). GitHub *PR review* does not (§7).

### 2.3 Main-process core

- A real **composition root** (review.md §2): builds the DB, constructs core
  services, activates plugin `main` parts in dependency order, wires the harness,
  *then* starts the HTTP listener; owns `will-quit` teardown by disposing
  everything it activated, and runs each plugin's registered `reconcile()` on
  boot.
- **The PTY engine**: spawn/attach/kill/resize/status, tmux persistence, the
  session table — today's `terminal.ts` stripped of its composition-root role and
  its knowledge of profiles (profiles become contributions, §4.11).
- **The worktree service**: `taskWorktree.ts` unchanged — the taskId-as-capability
  model (`resolveTaskCwd`/`resolveInRoot`) is already the best boundary in the
  codebase and becomes the core primitive every plugin gets file access through.
- **The IPC bus**: one typed channel registry (review.md recommendation #3).
  Plugins declare channels with request/response types; the core generates the
  preload exposure and the renderer client from the same declaration. A plugin
  never touches `ipcMain`/`ipcRenderer` directly. (Per review.md's technology
  analysis, the endgame is smaller still: most IPC collapses onto the loopback
  HTTP server with a WebSocket for PTY streams, leaving only true Electron-isms —
  dialogs, webContents binding — on this bus.)
- **The run-config loader**: the layered `.acorn/config.toml` → `~/.acorn` → DB
  merge (`runConfig.ts`) — already the most plugin-shaped thing in the app; it
  becomes the core's *file-configurable contribution* mechanism (workflows and
  run targets already live here; §4.10, §4.12).

### 2.4 MCP core

- The stdio server skeleton, task scoping from `ACORN_*` env, the loopback HTTP
  client, and the tool registry that agent-tool contributions (§4.8) project
  into. Tool availability becomes dynamic (`tools/list_changed`) instead of
  frozen at connect.

---

## 3. The extension model

### 3.1 The plugin unit

```ts
// plugins/<name>/index.ts
export const plugin: AcornPlugin = {
  id: 'linear',
  requires: [],                    // hard deps on other plugin ids
  enhances: ['github'],            // soft deps: activate after, degrade without
  capabilities: { main: false },   // which parts need the desktop bridge
  client: () => import('./client'),// per-process entrypoints, lazy
  server: () => import('./server'),
  main:   () => import('./main'),
}
```

Each entrypoint exports an `activate(ctx)` receiving that process's typed
context, and returns contributions + disposables:

```ts
// plugins/linear/client.ts
export function activate(ctx: ClientPluginContext) {
  ctx.panes.register(linearIssuePane)
  ctx.sources.register(linearSource)
  ctx.settings.register(linearSettingsSection)
  ctx.contentLinks.register(linearIssueLinkifier)     // extends other plugins' rendered content
  return ctx.disposables
}
```

`ctx` is the whole core API surface for that process — registries (§4), core
services (§5), and the event bus. Nothing is imported from another plugin's
internals; cross-plugin extension happens through contribution points the
*extended* plugin itself declares (§3.4).

### 3.2 Activation & lifecycle

- Static registry (`plugins/index.ts` lists them; a pref can disable one).
- Order: core services → plugins in `requires`-topological order → shell render →
  HTTP listener. This kills the half-wired-API race by construction.
- Every registration returns a `Disposable`; deactivation (or app quit) disposes
  in reverse. The three-call-site `evictPreviewWebview` obligation becomes one
  `ctx.events.on('task:archived', …)` subscription inside the preview plugin.
- Boot-time recovery: a `main` part may register `reconcile()` (tmux resurrect,
  worktree prune, workflow resume); the composition root runs them in one place.

### 3.3 UI slots

The shell's regions, made explicit. Each slot is an ordered registry of
contributions with a `when` predicate (reactive):

| Slot | Today filled by | Contribution shape |
| --- | --- | --- |
| `topbar.left` | collapse toggle, WorkspacePicker, RepoPicker, breadcrumb | component + order |
| `topbar.right` | NotificationBell, terminal toggle, AccountMenu | component + `when` |
| `rail.sources` | GitHub/Linear/Rollbar source buttons | from source registry (§4.2) |
| `rail.taskRow.badges` | checks dot, dirty ✎, needs-you ‼, unread, missing ⚠ | `(task) => Badge \| null` |
| `main.view` | browse views + task view + PR three-pane | from source/pane registries |
| `task.paneRow` | the 9 panes | from pane registry (§4.1) |
| `task.switcher.extra` | run ▶ buttons, agents ⠿, terminal >_ | button + `when` |
| `drawer.bottom` | TerminalPanel | singleton socket |
| `panel.right` | AgentsPanel | singleton socket |
| `overlay` | palettes ×4, settings modal, onboarding, shortcuts help | overlay registry |
| `settings.pages` | 8 general tabs + per-workspace pages | §4.6 |

The task-row badge slot is worth calling out: today `TabRail.tsx:287-304`
hardcodes five badge computations that belong to four different features
(checks → github, dirty → changes, unread → notifications, working-spinner →
terminal). Badge contributions make the rail feature-blind.

### 3.4 Cross-plugin extension

Some of today's best UX is one feature reaching into another: Linear IDs
linkified inside the PR description (`contentLinks.ts` consumed by
`PullDetail.tsx`), review notes sent to an agent PTY, the context pane jumping to
the notes pane. The rule: **the extended plugin declares the point.**

- `github` declares `contentLinks` (pattern → resolver) — `linear` contributes.
- `core` declares `sendToAgent` (the PTY paste channel) — changes/context/editor
  plugins consume it as a service, not by importing the terminal feature.
- Pane-to-pane navigation goes through the layout dispatcher plus a typed
  `openPane(paneId, intent)` — replacing the `noteToOpen` / `requestTerminalFocus`
  one-shot mailbox signals with one core mechanism.

---

## 4. Contribution point catalog

Each point below names its consumer registry, its interface (abbreviated), and
the current code it replaces.

### 4.1 Panes

```ts
interface PaneContribution {
  id: string                        // 'github.pr', 'core.editor'
  label: string; glyph: string
  order: number                     // replaces PANE_ORDER
  defaultChord?: string             // 'meta+shift+e' — into keybinding registry
  when?: (task: Task) => boolean    // replaces hasPr()/linearLinks() switcher gating
  component: Component<{ task: Task }>
  keepAlive?: 'dom' | 'none'        // preview's persistent <webview> contract
}
```

Replaces: the `PaneId` union + `PANE_LABELS` + `PANE_ORDER` + `PANE_IDS`
(`layout.ts:9-41`), the `paneBody()` ladder and hand-written switcher buttons
(`TaskView.tsx:172-262`), `PANE_SHORTCUT_DEFAULTS` (`paneShortcuts.ts:14`).
The palette's Show/Close-pane rows, the switcher, the shortcut defaults, and the
help screen all derive from this registry. Persisted layouts keep unknown ids
inert (generalizing `isPaneId`).

The **pane contract must be uniform**: a pane receives `{ task }` and must not
read the router. This forces the one real fix the current code needs — the `pr`
pane's PullDetail/DiffView read `useParams()` and require global navigation
(`TaskView.tsx:174-186`, `activate.ts:11-15`). Under the plugin model the github
plugin's pane resolves owner/repo/number from `task` itself.

`keepAlive: 'dom'` is the honest generalization of the preview pane's
body-parented webview: the core owns an off-tree layer keyed by (pane, task) and
the positioning dance, instead of the plugin hand-managing `previewWebviews`.

### 4.2 Sources (rail entry + browse view + task origin)

```ts
interface SourceContribution {
  id: string                        // 'github', 'linear', 'rollbar'
  glyph: string; label: string
  when?: () => boolean              // 'integration connected' — replaces availableSources()
  browse: Component                 // LinearBrowse / RollbarBrowse / the PR three-pane
  originGlyph: string               // replaces ORIGIN_GLYPH
  defaultPane?: string              // pane to open when a task is promoted from this source
  seedTask?: (item) => TaskSeed     // the promote flow
}
```

Replaces: `SOURCE_IDS`/`isSourceId` (`tasks.ts:13-15`), `availableSources`
(`sources.ts:9`), the hand-written `<Match>` per source in `App.tsx:415-487`,
`ORIGIN_GLYPH` (`TabRail.tsx:28`), the per-source branch in `activateTaskSignals`
(`activate.ts:23`). Task `origin` becomes the contributing source's id (the
schema column is already free text). Adding a source drops from ~10 touch points
(inventory §2) to one contribution.

### 4.3 Commands & palettes

```ts
interface CommandContribution {
  id: string; title: string; category: 'action' | 'task' | 'workspace' | …
  when?: () => boolean
  run: (ctx) => void | Promise<void>
}
```

One command registry feeds ⌘K. The palette's hardcoded action list
(`CommandPalette.tsx:63-80`) becomes contributions from the owning plugins (New
terminal → terminal plugin; Archive → core tasks; New Claude Code → the
claude-code profile plugin). Run targets, layout recipes, and workflows already
arrive as *data*; they become palette **item providers** — a second, coarser
contribution for plugins that inject dynamic rows (`(query) => PaletteItem[]`).
The overlay mechanics (`createOverlayPalette`, the `activeClose` mutex) are core;
FilePalette/WorkspacePalette are plugins registering overlays with their own
toggle chords.

### 4.4 Keybindings

```ts
interface KeybindingContribution {
  id: string; chord: string; when?: 'global' | 'task' | 'typing-exempt'
  command: string                   // command id — bindings bind commands, not closures
}
```

One registry owns: registration, conflict *detection* (replacing the
hand-maintained `RESERVED_CHORDS` denylist and the prose comments coordinating
TabRail vs TerminalPanel numerics), user remapping (generalizing the
`pane_shortcuts` pref machinery), and the help screen (replacing the third
hand-synced copy in `Shortcuts.tsx:17-31` — the help renders the registry, so it
cannot lie). The ten scattered `window` keydown listeners collapse into one core
dispatcher plus component-local editor/terminal handling where focus semantics
genuinely differ (Monaco ⌘S, xterm passthrough).

### 4.5 API routes (server)

```ts
ctx.routes.mount('/api/linear', linearRouter)        // namespaced by convention
```

Server plugin parts mount routers exactly as `server/index.ts:31-58` does today
— that mechanism is fine; it just moves from one hand-edited file into plugin
activation. The core enforces the two things convention currently carries:
authenticated-by-default (a `requireUser` wrapper — review.md #6) and the shared
error envelope. The `/api/repos` fan-in of 11 routers becomes internal structure
of the github plugin.

### 4.6 Settings pages

```ts
interface SettingsContribution {
  id: string; label: string; group: 'general' | 'workspace'
  component: Component<{ workspace?: Workspace }>
}
```

Replaces the `TABS` list in `SettingsModal.tsx:23-31`. Appearance/shortcuts/
permissions are core pages; integrations, MCP inspector, workflows inspector,
terminal defaults, and the per-workspace script editors come from their plugins.
Workspace-scoped script fields (setup/dev/teardown/dbUrl) become **workspace
config contributions** — a plugin declares the fields it stores on the workspace
and the settings form renders them — so the `workspaces` table stops accreting
per-feature columns (`schema.ts:278-285`).

### 4.7 Context sections

```ts
interface ContextSectionContribution {
  id: string                        // 'pr' | 'issues' | 'notes' | 'memory' | …
  label: string
  defaultIncluded: boolean          // context pane tray default
  assemble: (task: TaskRef) => Promise<ContextSection | null>   // server-side
}
```

Replaces the hardcoded `include=pr,issues,notes,memory` sections in
`taskContext.ts` and the `setContextNotesSource`/`setContextMemorySource` global
setters. The assembler route iterates the registry; the Context pane tray, the
`formatContextBlock` push path, and the MCP `task_context` pull path all follow
automatically. A future "recent CI failures" section is one contribution.

### 4.8 Agent tools — the keystone point

```ts
interface AgentToolContribution {
  name: string                      // 'notes_append', 'browser_click'
  description: string
  input: ZodSchema
  scope: 'task'                     // receives { taskId, worktreePath, sessionId }
  when?: (task) => Promise<boolean> // replaces the connect-time hasRunTargets freeze
  handler: (input, scope) => Promise<unknown>   // runs in main
  exposeToRenderer?: boolean        // also project a typed IPC client
}
```

One declaration; the core projects it three ways:
- an **MCP tool** (schema straight from `input`; availability re-evaluated, with
  `tools/list_changed` on transitions);
- a **harness HTTP route** (`POST /api/tasks/:id/tools/:name`, `INTERNAL_TOKEN`
  auth, the `respond()` envelope) — so non-MCP agents and tests hit the same
  surface;
- optionally a **renderer client method** over the typed IPC bus.

This collapses the five-edit-site pipeline (preload → knowledgeIpc → harness
route → bridge → MCP tool) into one object, and structurally prevents the
semantic forks the current channels have already grown (agent-vs-UI note
creation differing in frontmatter/provenance — review.md §1d): there is one
handler, and provenance (`author`, `sessionId`) comes from `scope`, supplied by
the channel.

Replaces: all of `harness.ts`'s bridge types + setters, `harnessWiring.ts`, the
per-tool bodies in `mcp/server.ts`, and the notes/memory/run/browser groups in
`preload.ts`/`knowledgeIpc.ts`.

### 4.9 Mirrored resources (server sync descriptors)

```ts
interface MirroredResource<Row> {
  id: string                        // 'github.pulls', 'linear.issues'
  ttlMs: number                     // today: 45s / 300s / 600s / 120s, centralized at last
  etag?: boolean
  fetch: (key, prior: SyncState) => Fetched<Row> | NotModified
  persist: (tx, key, rows: Row[]) => void      // atomic delete-then-insert inside db.batch
}
```

The core sync engine owns the four-branch serve/revalidate/cold state machine,
`sync_state` bookkeeping, background-refresh tracking, and rate-limit backoff —
in one place instead of five divergent copies (review.md §1c). The github plugin
registers pulls/detail/files/repos descriptors; linear and rollbar register
theirs. TTL constants live on the descriptor: the caching policy becomes
greppable data.

### 4.10 Workflow step kinds & policies

```ts
ctx.workflows.registerStepKind('ci-loop', ciLoopHandler)      // Map<kind, StepHandler>
ctx.workflows.registerPolicy('checks-green', checksGreenEval) // github plugin contributes
```

Replaces the `executeStep` if-ladder (`workflowRunner.ts:189-250`) and the
one-case `evaluatePolicy` switch. Note the layering this reveals:
`checks-green` needs the GitHub mirror, so the *policy* belongs to the github
plugin while the *engine* is the workflows plugin — exactly the dependency the
current code hides inside `workflowWiring.ts`. Step kinds named in
`.acorn/workflows/*.toml` resolve against the registry; unknown kinds surface as
parse errors (the loader already does this well).

### 4.11 Agent profiles

```ts
interface AgentProfileContribution {
  id: string                        // 'claude-code', 'codex', 'aider', 'shell'
  command: string; backendPreference: 'tmux' | 'node-pty'
  mcpRegistration?: (spec: LauncherSpec) => RegisterArgv   // replaces PROFILE_MCP_FLAVOUR
  headlessArgv?: (opts) => string[]                        // replaces headless.ts branches
  resumeArgv?: (sessionRef) => string[]                    // replaces resumeCommandFor
  streamJson?: StreamJsonAdapter                           // agents-panel activity parsing
}
```

Replaces `BUILTIN_PROFILES` (`profiles.ts:21-26`), `PROFILE_MCP_FLAVOUR`
(`terminal.ts:356`), the per-agent branches in `headless.ts:30` and
`agents/model.ts`. Each agent (claude-code, codex, aider) becomes a small plugin;
adding one no longer edits four files. The deferred `agent_profiles` table
(`profiles.ts:4`) becomes unnecessary — file-based plugins *are* the
user-editable registry.

### 4.12 Run targets & layout recipes — already there

`.acorn/config.toml` (`runConfig.ts`) is the existing proof that acorn's
contribution model works: run targets, recipes, and workflows are declarative,
layered (repo → user → DB), validated with surfaced errors, and consumed by
several subsystems (palette, preview, MCP, TaskView) without those consumers
knowing each other. The plugin architecture keeps this mechanism as-is and adds
one thing: plugins may register **config sections** (schema + parser) so a new
plugin can extend the TOML without editing `runConfig.ts`.

### 4.13 Themes, notifications, content links, status pollers

- **Themes**: `{ id, label, css }` contributions replacing the `THEMES` array +
  hand-edited `tokens-layout.css` blocks (the existing test that guards
  list-vs-CSS becomes a registry invariant).
- **Notification kinds**: `{ kind, glyph, toastPolicy }` replacing the
  `NoticeKind` union and `KIND_GLYPH`; anyone can `ctx.notices.push(...)`. Edge
  detection (`detectEdges`) stays in the terminal plugin; workflow notices in the
  workflows plugin.
- **Content links**: pattern + resolver + in-app navigation target
  (generalizing `contentLinks.ts`), consumed by any plugin that renders rich text.
- **Task status pollers**: the rail's dirty/checks poll becomes per-plugin
  contributions feeding the badge slot, instead of `term:task:statuses` carrying
  a fixed shape.

---

## 5. Core services plugins consume

The other half of the contract — what `ctx` hands a plugin:

| Service | Backing (today) | Notes |
| --- | --- | --- |
| `ctx.tasks` / `ctx.workspaces` | `tasks.ts`, tasks/workspaces routes | read + typed mutations; no direct table access from plugin client code |
| `ctx.layout` | `applyLayoutAction` dispatch | `openPane(id, intent?)` replaces the mailbox signals |
| `ctx.query` | TanStack client + shared key discipline | plugins namespace keys; invalidation helpers per resource |
| `ctx.prefs` | prefs table + restore pipeline | namespaced (`plugin:key`); hydrate/persist ordering owned by core |
| `ctx.storage.files(taskId)` | `taskWorktree` capability | the only path-resolution API; confinement enforced |
| `ctx.db` (server/main) | shared SQLite conn | plugins own their tables; migrations contributed per plugin, run by core |
| `ctx.blobs` | on-disk SHA store | plain `readBlob/writeBlob` (the KV costume retired) |
| `ctx.terminal` | PTY engine | `create/attach/sendToAgent/onStatus`; profiles come from §4.11 |
| `ctx.ipc` | typed channel bus | declare-once channels; preload + client generated |
| `ctx.events` | new | typed bus: `task:created/activated/archived`, `workspace:switched`, `session:status`, `boot:restored` |
| `ctx.gh` | `server/github` clients | the REST/GraphQL clients + `ghError` taxonomy, exposed to server plugin parts (github plugin is its main user; others may read rate-limit state) |

`ctx.events` deserves emphasis: it is the disciplined replacement for the three
ad-hoc coupling channels found in review (`pendingTerminalFocus`,
`FILE_SCROLL_EVENT`, manual `evictPreviewWebview`) and for the archive flow's
"three obligations that must stay in sync" (inventory §11 note). `task:archived`
fires once from core; terminal teardown, worktree removal, preview eviction, and
query invalidation are each a subscriber.

---

## 6. What the app looks like assembled

```
core/
  client/   shell, slots, registries, layout reducer, prefs pipeline, event bus
  server/   createApp, session/auth, sync engine, harness gateway, prefs routes
  main/     composition root, PTY engine, worktree service, IPC bus, config loader
  mcp/      stdio skeleton, tool projection

plugins/
  github/          source (browse three-pane) · pr pane · mirrored resources ·
                   PR mutations · checks badge + poller · 'checks-green' policy ·
                   create-PR flow · mentions/labels · contentLinks host
  linear/          integration provider · source + browse · issue pane ·
                   issues context section · linkifier · comment mutation
  rollbar/         integration provider · source + browse · item pane
  editor/          editor pane · file palette overlay · editor IPC · autosave
  changes/         changes pane · local-git IPC · review notes (+ routes) ·
                   dirty badge · review-prompt sendToAgent
  notes/           notes pane · NotesStore · notes context section ·
                   notes_* agent tools · note seeding
  memory/          memory tray · memory index/proposals · memory context section ·
                   memory_* agent tools · review trigger
  context/         context pane (tray UI over the section registry)
  preview/         preview pane (keepAlive) · webview layer · browser_* agent tools ·
                   CDP driver · url resolution over run targets
  database/        database pane · pg pools · db IPC · dbUrl workspace config
  terminal/        bottom drawer · sessions store · session-edge notices ·
                   term IPC surface · run-target execution (RuntimeService)
  agents/          right panel · roster model · stream-json adapters
  profiles-claude/ agent profile (+ mcp registration flavour)   [tiny]
  profiles-codex/  agent profile                                 [tiny]
  profiles-aider/  agent profile                                 [tiny]
  workflows/       step-kind registry + runner · TOML defs · gates ·
                   workflow palette items · inspector settings page · notices
  onboarding/      first-run modal
```

Boot: composition root → core services → plugins (topo order) → shell mounts
slots → listener starts → `boot:restored` fires → prefs pipeline hydrates
plugin slices in registration order.

---

## 7. Parity map

Every shipped feature, its plugin, and the contribution points it uses. ✅ = no
open design question; ⚠ = named hard part (§8).

| Current feature | Plugin | Points used | |
| --- | --- | --- | --- |
| PR list / browse three-pane | github | source, mirrored resources, commands (`c` create-PR, `[`/`]`, `j`/`k`) | ✅ |
| PR detail + conversation + reviews | github | pane, routes, mutations | ✅ |
| Diff rendering + viewed files + inline comments | github | pane (within pr pane), blobs service | ✅ |
| Checks panel + rerun + rail checks dot | github | pane section, badge slot, poller | ✅ |
| Create PR flow | github | commands, routes | ✅ |
| PR context section + `pr_current`/`pr_changed_files` tools | github | context section, agent tools | ✅ |
| Linear connect/browse/pane/comments | linear | integration, source, pane, routes | ✅ |
| Linear linkification in PR body | linear → github | contentLinks | ✅ |
| Rollbar connect/browse/pane | rollbar | integration, source, pane | ✅ |
| Issues context section + `linked_issues` | linear/rollbar | context section, agent tool | ✅ |
| Editor pane + tree + autosave + ⌘P file finder | editor | pane, overlay, IPC channels, prefs slice | ✅ |
| Changes pane + stage/commit/push + review notes | changes | pane, IPC, routes, badge | ✅ |
| `local_changes`/`local_diff`/`git_log` tools | changes | agent tools (in-process handler, no loopback hop) | ✅ |
| Notes pane + global notes + included-flag | notes | pane, agent tools, context section | ✅ |
| Memory tray + proposals + FTS index | memory | context section, agent tools, settings | ✅ |
| Context pane + send-to-agent | context | pane, `ctx.terminal.sendToAgent` | ✅ |
| Preview pane + persistent webview | preview | pane (`keepAlive`), events (`task:archived`) | ⚠ §8.2 |
| Agent-drivable browser (`browser_*`) | preview | agent tools + CDP driver | ✅ |
| Database pane + pools + dbUrl script | database | pane, IPC, workspace config contribution | ✅ |
| Terminal drawer + tabs + tmux persistence | terminal | drawer socket, PTY service, prefs | ✅ |
| Run targets + ▶ buttons + `run_*` tools + recipes | terminal | config sections, palette provider, agent tools (`when:` un-freezes availability) | ✅ |
| Agents panel + roster + resume | agents | panel socket, profile registry, workflow read API | ✅ |
| Agent profiles (claude/codex/aider) + MCP registration | profiles-* | agent profile | ✅ |
| Workflows: TOML defs, runner, gates, inspector, notices | workflows | step kinds, policies (github contributes `checks-green`), palette provider, settings page, notification kinds | ✅ |
| Notification bell + OS toasts + rail unread | core + contributors | notification kinds, badge slot | ✅ |
| ⌘K/⌘P/⌘L palettes + `/` finder + `?` help | core + plugins | commands, palette providers, overlays | ✅ |
| Pane chords + remapping + reserved chords | core | keybinding registry | ✅ |
| Settings modal (all pages) | core + plugins | settings pages, workspace config contributions | ✅ |
| Themes (12) + follow-system | core + theme contributions | themes | ✅ |
| Workspaces/tasks/rail/drag-order/⌘1-9 | core | — | ✅ |
| Worktree lifecycle + archive + setup/teardown scripts | core + plugins | events, workspace config | ✅ |
| Auth/session/OAuth/permissions | core | — | ✅ |
| Onboarding modal | onboarding | overlay | ✅ |
| MCP server + INTERNAL_TOKEN + task scoping | core | tool projection | ✅ |
| Offline mirror + ETag/TTL + blob cache | core (engine) + github (descriptors) | mirrored resources | ✅ |
| Startup restore (last repo/task/source, layouts, editor tabs, filters, notices) | core pipeline + plugin slices | prefs slices | ⚠ §8.3 |

Nothing in the inventories lacks a home. The parity claim holds *if* the four
hard parts below are resolved as described.

---

## 8. The hard parts (named honestly)

**8.1 The github plugin is enormous.** ~60% of the server and the two largest
client components land in one plugin. That is fine — plugin ≠ small — but it
means the plugin model alone doesn't fix review.md's DiffView/PullDetail
concern-fusion; that decomposition is internal to the github plugin and still
worth doing. The test of the architecture is not github's size but whether
*linear* stays small (it does: ~6 contributions) and whether github can be
disabled leaving a working local-task app (it can, if auth stays core — which is
why it must).

**8.2 keepAlive panes leak platform details into the core.** The preview
webview must survive pane switches and be positioned over a host rect; the core
layer that provides `keepAlive: 'dom'` has to own reparenting, z-index vs
overlays, and eviction. This is genuinely intricate (the current implementation
is subtle for good reasons) but it is *one* plugin's requirement generalized —
and centralizing it is still better than the module-level `previewWebviews` Map
with three manual eviction call sites.

**8.3 The restore pipeline is ordering-sensitive.** Slices are not independent:
workspace restore must precede task activation, which must precede pane focus;
`isRestoring()` gates fetches. The core pipeline must make phases explicit
(`restore: 'workspace' | 'view' | 'panes'`) rather than pretending slices are
order-free — otherwise the plugin model just re-scatters today's App.tsx race
into fifteen plugins. This is the single riskiest piece of core to build; do it
first and port slices one at a time.

**8.4 Typing without closed unions.** `PaneId` as a union gives exhaustiveness
checks the registry model gives up. Mitigations: branded `PaneId` strings minted
only by `panes.register`; registry lookups return `Option`, never throw;
persisted-state parsers already tolerate unknowns. Where exhaustiveness
genuinely matters (the layout reducer), the logic is already id-agnostic. The
trade is real but small — and today's "union + 4 parallel hand-synced lists" is
exhaustiveness theater anyway (`PANE_IDS` can silently drift from `PaneId` now).

**8.5 Cross-plugin schema coupling.** `task_links.provider`, `issues.provider`,
task `origin` are provider strings owned by source plugins but stored in core
tables. Rule: core owns generic tables keyed by contribution id; plugins own
their private tables and contribute migrations. The `issues.data` JSON blob gets
a per-plugin codec (parse + validate at the boundary) instead of today's
cast-and-hope.

---

## 9. Getting there (order of operations)

This is a direction, not a rewrite. Each step is independently shippable and
most are already recommended in review.md for non-plugin reasons.

1. **Registries in place, same code** — pane registry (review.md #5), command
   registry, keybinding registry, settings-page registry. Hardcoded ladders
   become registry iteration; features still statically imported. This alone
   delivers most of the extensibility win.
2. **The event bus + composition root** (review.md #4) — kill the global-setter
   wiring, the boot race, the manual eviction trio; add `will-quit`.
3. **The typed IPC bus** (review.md #3) — declare-once channels; preload
   generated.
4. **Agent-tool projection** (§4.8) — collapse harness/MCP/IPC into one
   declaration; port notes/memory/run/browser tools onto it.
5. **The sync engine** (review.md #2) — extract, then express github/linear/
   rollbar reads as descriptors.
6. **The restore pipeline** (§8.3) — phased core service; port App.tsx effects
   slice by slice.
7. **Foldering** — only now move code into `core/` + `plugins/`; the seams
   already exist, so this step is `git mv` plus lint rules (no plugin→plugin
   internal imports, no core→plugin imports).
8. **Optional endgame** — a dynamic loader and out-of-tree plugins, if a real
   need appears. Everything above is worth it even if this step never happens.

The litmus test for done: adding a Sentry integration (source + pane + context
section + linkifier) or a fourth agent profile touches **zero** core files.
