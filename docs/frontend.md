# Frontend

The acorn client shell — how the SolidJS SPA boots, how the layout switches between browse
sources / tasks / the classic PR browser, how session state is restored, and where each kind of
state lives. Per-pane behaviour lives in [panes.md](./panes.md); this doc is about the shell and
its state model.

## Overview

The client is a SolidJS single-page app under `apps/desktop/src/client/`. It is served as static
assets by the in-process Hono server (running in the Electron main process on
`http://127.0.0.1:4317`) and talks to that same origin over cookie-authenticated `fetch` — the
GitHub token never reaches the browser (see [authentication.md](./authentication.md)).

State is deliberately split three ways, with no other store:

| Kind | Home | Survives reload? |
| --- | --- | --- |
| Server data (PRs, repos, tasks, workspaces, Linear/Rollbar) | [TanStack Query](./caching.md) cache | Yes — persisted to IndexedDB |
| Transient UI (popovers, drag, focus/maximize, active terminal) | module-level / component SolidJS signals | No |
| Durable view state (last repo, layouts, theme, shortcuts) | server-persisted `prefs` (the `/api/prefs` key/value store) | Yes — round-trips through GitHub-scoped SQLite |

## Entry point (`index.tsx`)

`index.tsx` mounts the app and owns cross-cutting cache concerns:

- Constructs a **single** `QueryClient` with `refetchOnWindowFocus: true` and `gcTime: 24h`. The
  long `gcTime` is required so persisted entries outlive a session and survive reload
  (`apps/desktop/src/client/index.tsx:21`).
- Wraps the tree in `PersistQueryClientProvider`, persisting the bounded cache to **IndexedDB** via
  `idb-keyval` under key `acorn-cache` (`maxAge` 24h, 2s write throttle). File bodies and
  patch-bearing queries are excluded because the loopback API/on-disk blob cache reconstructs them;
  TanStack's successful-query-only gate also excludes pending and failed queries.
- A global `QueryCache`/`MutationCache` `onError` bounces to `/auth/login?return_to=…` whenever an
  error message matches `/\b401\b|reauth|unauthenticated/` — a revoked/expired token surfaces as a
  401 from any read or write. The `me` query returns `null` on 401 (the valid logged-out state) so
  it never trips this (`index.tsx:14`).
- Wipes the persisted cache on the `acorn:logout` window event, so the next user can't read it
  (`index.tsx:51`), and unregisters any service worker left over from a prior web (Cloudflare
  Workers) visit to this origin (`index.tsx:55`).
- Mounts `<Router root={App}>` with four routes whose components are all `noop` — **routes exist
  only to populate `useParams()`**; `App` is the layout root and renders the actual UI from those
  params (`index.tsx:39`).

### Routes

| Route | Params | Purpose |
| --- | --- | --- |
| `/` | — | Boot root. Electron always launches here; `App` redirects to the last/first repo once data loads. |
| `/:owner/:repo` | `owner`, `repo` | Scopes the app to a repo (and, derived from it, a workspace). |
| `/:owner/:repo/new` | `owner`, `repo` | Create-PR mode (static segment; outranks `:number`). |
| `/:owner/:repo/:number` | `+ number` | A specific PR (classic browser detail/diff, or a PR task). |

The active **workspace** carries no URL dimension — it is derived from the current repo
(`workspaceForRepo`, a partition: a repo belongs to exactly one workspace). The selected browse
**source** and **active task** are signals, not routes.

## Layout shell (`App.tsx`)

`App` is the router root. It gates on auth (`<Show when={me.data}>`, else `LoginGate`), applies the
theme, and lays out a left `TabRail` beside a topbar + a main-area `Switch`:

```
┌──────┬───────────────────────────────────────────────────────────────┐
│ Tab  │ topbar: [«] Workspace  Repo    owner / repo / #n   🔔 ▣ Account │
│ Rail ├───────────────────────────────────────────────────────────────┤
│      │ main <Switch>:                                                  │
│ src  │   • selectedSource==='linear'  → <LinearBrowse>                 │
│ src  │   • selectedSource==='rollbar' → <RollbarBrowse>               │
│ ──   │   • no source && activeTask()  → <TaskView> (panes + terminal)  │
│ task │   • fallback (github browse)   → 3-pane PR browser:             │
│ task │        [ PullList | PullDetail | DiffView ]                     │
│  +   │        or /new → [ CreatePullForm | ComparePreview ]           │
└──────┴───────────────────────────────────────────────────────────────┘
            terminal drawer (bottom, per-task, flagged) ─┘
```

The left `TabRail` (see [workspaces-and-tasks.md](./workspaces-and-tasks.md)) holds the source
buttons (GitHub always; Linear/Rollbar when connected) and the workspace-scoped task rows; it is
always mounted. The right column is a CSS grid of `var(--topbar-h) 1fr` — topbar over the main
`Switch`. See [ui-design.md](./ui-design.md) for tokens.

### Topbar clusters

`.topbar` is a `1fr auto 1fr` grid with three regions:

| Region | Contents |
| --- | --- |
| Left (`.topbar-side`) | Collapse toggle (`«`/`»`, drives the `left_collapsed` pref); `WorkspacePicker` (selecting a workspace navigates to its first repo); `RepoPicker` (scoped to the active workspace, **disabled inside a task view** since the repo is fixed to that worktree). |
| Center (`.breadcrumb`) | `owner / repo / #number` crumbs (the `#n` crumb links out to GitHub), or the `acorn` brand when no repo is routed. |
| Right (`.topbar-end`) | `NotificationBell`; a terminal toggle `▣` (only when `terminalEnabled` and in a task view); `AccountMenu` (Settings / Clear cache / Logout) or a `Login` link. |

### The four main modes

The main-area `<Switch>` (`App.tsx:370`) selects exactly one view from two signals —
`selectedSource()` and `activeTask()`:

| Condition | View | Notes |
| --- | --- | --- |
| `selectedSource() === 'linear'` | `LinearBrowse` | Linear ticket browse (integration live). |
| `selectedSource() === 'rollbar'` | `RollbarBrowse` | Rollbar error browse. |
| no source **and** an active task | `TaskView` | The task's pane row + per-task terminal drawer. |
| fallback (github source) | classic 3-pane PR browser | `PullList` / `PullDetail` / `DiffView`, or on `/new` a `CreatePullForm` + `ComparePreview`, or the `Acorn` mark when no repo is routed. |

So "GitHub browse" is the fallback: `selectedSource()` is `'github'` and no task is active. Picking
a source in the rail sets `selectedSource`; clicking a task row clears the source and sets
`activeTaskId`. Task activation is shared logic — `activateTaskSignals` + `pathForTask`
(`features/tasks/activate.ts`) flip the signals, mark the task's notices read, and compute the
route, and are reused by the rail rows, ⌘1–9, and the palette's Go-to-task. Overlays
(`SettingsModal`, `OnboardingModal`, `TerminalPanel`, `CommandPalette`, `FilePalette`) and the
global `Shortcuts` handler are mounted after the switch, independent of the active mode.

`TaskView` is keyed by `activeTaskId`: switching or archiving a task disposes the old task-owned
component scope before the replacement mounts. The archive lifecycle event then performs final
T3/T4 eviction after component cleanup has published any last session-only view state.

### Login gate + theme

`LoginGate` shows the bare `Acorn` mark while auth is unknown (initial load / cache restore) to
avoid a redirect flash, then bounces to GitHub OAuth once settled-logged-out — unless the user
explicitly logged out (`sessionStorage['acorn:loggedout']`), in which case it holds and offers a
manual Login (else GitHub silently re-auths and logout is a no-op) (`App.tsx:269`, `464`).

Theme is applied by the startup-state service writing `document.documentElement.dataset.theme`.
When `theme_follow_system` is on it swaps the chosen `theme_light`/`theme_dark`
on the OS `prefers-color-scheme` and re-applies live on change; otherwise it uses the fixed `theme`
pref.

## Session restore

`persistence/startupRestore.ts` treats `prefs` as the durable view layer. Registered descriptors
hydrate in `workspace → view → panes` order, emit `boot:restored`, then arm throttled persistence.
The service waits for `useIsRestoring()`, prefs, repos, and tasks before navigation, so startup
defaults cannot clobber saved state or drop a gated query mid-restore. Descriptors registered by
lazy plugins after boot hydrate before their own persistence is armed. See [state.md](./state.md).

Core prefs and scoped slices that make up a restored session:

| Pref key | Restores | Writer |
| --- | --- | --- |
| `last_path` | The `/:owner/:repo[/:number]` that reopens on relaunch. | shell descriptor |
| `last_source` | The selected browse source (`''` = a task view was active). | shell descriptor |
| `last_task` | Which task is focused. | shell descriptor |
| `core:task-layouts:<taskId>` | A task's pane row; legacy `task_layouts` / `task_panes` migrate on hydrate. | layout descriptor |
| `rail_order` | Task rail pin-to-top + drag order. | `TabRail` |
| `left_collapsed` | Left-pane collapse (`'1'`/`'0'`). | shell descriptor |
| `theme`, `theme_follow_system`, `theme_light`, `theme_dark` | Theme selection + follow-system. | `AppearanceSettings` |
| `pane_shortcuts` | Per-pane keyboard-shortcut overrides (JSON). | `ShortcutsSettings` |
| `term_rail_default` | Default terminal profile for a new task's rail. | `TerminalSettings` |
| `term_height` | Terminal drawer height. | `TerminalPanel` |
| `notices` | The last ~50 notification-centre notices (bounded ring). | notice descriptor |
| `editor:open-files:<taskId>` | Open-file tabs per task (content not persisted; dirty resets). | editor descriptor |
| `onboarded` | Whether the onboarding modal has been dismissed. | `OnboardingModal` |

Every write goes through `savePref`: the shared `prefsKey` cache updates optimistically, server
writes serialize per key, and failures roll back and surface as notices.

## State management

### TanStack Query (server data)

Query option factories live in `queries.ts` so multiple consumers share one definition (e.g. the
`RepoPicker` dropdown and `PullList` both read `repos`). Route builders, response types, and
query-key factories live in `../shared/api.ts`; `queries.ts` imports them and keeps the runtime
path as plain same-origin cookie `fetch` via the thin `apiClient.ts` (`readJson`/`writeJson`,
where `readJson(..., { nullOn401: true })` powers the logged-out `me` state). Writes live in
`mutations.ts` and POST/PUT/DELETE to the same route builders (the server checks `Origin` for CSRF).

Refetch behaviour is tuned per query rather than globally:

- **Polled:** `pullsOptions` refetches every 60s; `tasksOptions` refetches on focus (keeps
  dirty/PR markers fresh).
- **Short staleTime:** `runJobsOptions` (15s, running jobs change), Linear enrichment /
  `repoLabels` / `mentions` (5 min).
- **Immutable → `staleTime: Infinity`:** `fileBlobOptions` (body keyed by immutable SHA) and
  `jobLogOptions` (a completed job's log never changes). See [caching.md](./caching.md).

`prefetch.ts` warms the open-PR list in the background after it loads — batch-fetching each PR's
detail + file summaries (`CHUNK` 5, `CONCURRENCY` 2) and seeding the per-PR caches for an instant
first paint, abortable on repo switch, and `seedIfNotNewer` so it never overwrites fresher data.
It also exposes `schedulePullSummaryPrefetch`, an 80ms-debounced per-row hover prefetch. Patch
bodies are deliberately **not** warmed — they stay intent-driven in `DiffView` (see
[diff-rendering.md](./diff-rendering.md)).

### IndexedDB persistence

The filtered query cache is mirrored to IndexedDB (see entry point); file bodies and patches are
excluded, and writes are throttled. Consumers must gate first mount on
`useIsRestoring()` — mounting a gated query mid-restore can drop its fetch as the `enabled` flip
races the restore boundary (this is why `App`'s repo-redirect waits on `isRestoring()`).

### Module-level signal stores

Transient/live state that must not survive reload lives in signals-only modules (no query cache, no
prefs). They export getters + mutators in the codebase's single-writer style:

| Module | Owns |
| --- | --- |
| `features/tasks/tasks.ts` | `selectedSource`, `activeTaskId`, and per-task `taskLayouts` (all layout transitions go through `dispatchLayout` → the pure `applyLayoutAction` reducer); plus per-task terminal-open and recipe-browser-URL state. |
| `features/terminal/sessions.ts` | The live terminal-session list + a single `onStatus` subscription, so the rail/topbar can show agent-working activity even with the drawer closed. |
| `features/tasks/taskStatus.ts` | Live worktree status per task (dirty count / `missing`), 5s-polled + `onStatus` edges. |
| `features/notifications/notifications.ts` | The bounded in-memory notice ring (mirrored to the `notices` pref) + pure edge detection over session snapshots. |
| `features/editor/editorState.ts` | Open-file tabs per task (mirrored to `editor_open_files`). |

These are initialised once in `App`'s `onMount` (`initSessions`/`initTaskStatuses`/
`initWorkflowNotices`), each a no-op when the terminal bridge is absent, so they naturally show
nothing on a non-desktop build.

### Task pane layout

A task's layout is a **flat left→right row** of open panes: `TaskLayout = { panes: PaneId[] }`
(`features/tasks/layout.ts`). `PaneId` ∈ `pr | linear | rollbar | preview | editor | changes |
notes | context | database | search`. One pure reducer `applyLayoutAction` owns every transition — `show`
(single pane, from a switcher click), `add` (open beside via ⌘/Ctrl-click), `close`, `replace`
(recipe seeding). `normalizeLayout`/`parseTaskLayouts` defensively validate the persisted
`task_layouts` value (tolerating legacy shapes). Pane internals are documented in
[panes.md](./panes.md). (`ponytail:` a flat row, not a layout tree — open-what-you-want side by
side is enough.)

## Desktop IPC bridges (`window.acorn.*`)

The Electron preload (`apps/desktop/src/main/preload.ts`) exposes a **narrow** capability surface
on `window.acorn` via `contextBridge` — never raw `ipcRenderer`. Each feature has a typed accessor
that returns the bridge or `null`, so consumers degrade gracefully on a non-desktop build:

| Accessor | Bridge | Purpose |
| --- | --- | --- |
| `terminalApi()` — `features/terminal/terminalClient.ts` | `window.acorn.terminal` | PTY sessions, profiles, run targets, local-changes review, guarded task archive/teardown, `sendToAgent`, workflow calls, status/output subscriptions. |
| `memoryApi()` — `features/memory/memoryClient.ts` | `window.acorn.memory` | Committed `.acorn/memory` files + FTS search + proposal gate. |
| `notesApi()` — `features/notes/notesClient.ts` | `window.acorn.notes` | Workspace `.md` notes CRUD. |
| `editorApi()` — `features/editor/editorClient.ts` | `window.acorn.editor` | Read/list/write files on the task's worktree (Monaco pane). |
| `window.acorn.mcp` | — | MCP config inspector + register/unregister acorn's own MCP server. |
| `window.acorn.browser` | — | Bind a task's preview webview for CDP driving. |

`window.acorn.desktop` (plus `platform`, `onClosePane`) marks the desktop build. Everything above is
`null` on a web build. Availability is answered in one place: `capabilities()`
(`features/capabilities.ts`) reports `{ desktop, terminal }` from bridge presence — the terminal
surface (drawer, agent sessions, run targets, workflows) is **always on when the bridge exists**
(the old `acorn:term` localStorage flag is gone); bridge-absent (a plain browser via `dev:node`)
is the degraded mode. The typed accessors above remain the way to *invoke* the bridge. See
[terminal-and-agents.md](./terminal-and-agents.md) and [mcp.md](./mcp.md).

## Source

Key files: `apps/desktop/src/client/{index.tsx,App.tsx,apiClient.ts,queries.ts,mutations.ts,prefetch.ts}`,
`features/tabs/TabRail.tsx`, `features/tasks/{tasks.ts,layout.ts,activate.ts,TaskView.tsx}`, and the
signal stores under `features/{terminal,notifications,editor}/`.

See also: [panes.md](./panes.md) (the pane catalog), [workspaces-and-tasks.md](./workspaces-and-tasks.md)
(the rail + task model), [diff-rendering.md](./diff-rendering.md), [caching.md](./caching.md),
[ui-design.md](./ui-design.md), and
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md).

## Notes on shared plumbing

- Task activation lives once in `features/tasks/activate.ts`: `activateTaskSignals(t, { pane? })`
  (rail rows, ⌘1–9, the new-task flow, browse promotes, the notification bell, the palette) plus
  `pathForTask`. The optional `pane` forces a pane (promotes land on their provider pane);
  otherwise the saved layout is restored and only the first activation picks a default.
- Layout state has no single-pane shim: all pane transitions go through
  `dispatchLayout(taskId, action)` / `layoutForTask(taskId)` with an explicit task id.
- `last_source` keeps unknown contribution ids inert and round-trippable. A temporarily missing
  provider therefore does not destroy the user's selection; choosing another source replaces it.
- API failures are typed: `apiClient.ts` throws `ApiError` (message + HTTP `status`); the auth
  bounce in `index.tsx` is structural (`err instanceof ApiError && err.status === 401`), not
  message-text matching.
</content>
</invoke>
