# Command palette & keyboard model

acorn is keyboard-driven. This doc covers the three overlays — the **command palette** (⌘K), the
**file finder** (⌘P), and the in-PR **changed-file finder** (`/`) — plus the full global shortcut
table, the Task-view **pane shortcuts**, and the **Settings → Shortcuts** tab where the pane bindings
are edited. Every overlay reuses the same flat `.overlay` shell (`docs/ui-design.md`) and the shared
`createOverlayPalette` hook (`features/palette/overlay.ts`): one `window` keydown listener per
overlay, open/query/selection signals, ↑/↓ (clamped) / Enter / Esc handling, focus-on-open, and
backdrop click-to-close. There is no central dispatcher.

## 1. Command palette (⌘K)

The palette is split into a **pure model** (`apps/desktop/src/client/features/palette/model.ts`, unit
tested) and a **thin overlay** (`CommandPalette.tsx`) that is glue over it. The model does two things:
compose the item list from data sources, and fuzzy-filter it against the query.

### Item composition (`composeItems`)

`composeItems(sources)` emits items in a fixed order, then `fuzzyFilter` re-orders the survivors by
score. The kinds, in composition order:

| Order | Kind | Label shape | Notes |
| --- | --- | --- | --- |
| 1 | `error` | `config error (<source>): <message>` | Config/workflow parse errors. **Visible, not invocable** — they explain why a target might be missing. |
| 2 | `run` | `Run: <id>` / `Stop: <id>` | One row per run target; toggles on `running`. Hint is the command. |
| 3 | `layout` | `Layout: <id>` | A layout recipe: seed panes + auto-start a target. Hint `open panes + start target`. |
| 4 | `workflow` | `Workflow: <name>` | A committed `.acorn/workflows` definition. Hint `<n> steps`. |
| 5 | `action` | `New terminal`, `Show/Hide terminal drawer`, `Show pane: <label>`, `Close pane: <label>`, `Archive task` | Built-in task actions (see below). |
| 6 | `task` | `Go to task: <title>` | Navigation to another task, **last** — it's navigation, not a command. Hint `owner/name`. |

Errors are placed first deliberately (they explain missing targets); Go-to-task rows are placed last
deliberately (navigation, not a command). See `model.ts:23` for the exact order.

### The built-in actions

`CommandPalette.tsx` builds the `action` rows (`actions()`). All require an **active task**:

- **New terminal** — `api.create({ taskId, profileId: 'shell' })`, then opens the drawer.
- **Show / Hide terminal drawer** — toggles `isTerminalOpen(taskId)`.
- **Show pane: `<label>`** — one row per `PaneId` in the canonical order (`pr, changes, notes,
  context, editor, preview, browser, linear, rollbar` — `PANE_ORDER`, exported next to
  `PANE_LABELS` from `features/tasks/layout.ts`), dispatching a layout `show`.
- **Close pane: `<label>`** — only for panes currently open, and only when **more than one** pane is
  open (closing the last pane is a no-op the reducer guards anyway).
- **Archive task** — guarded teardown via `api.task.archive` behind a `window.confirm`.

### What requires a task vs the terminal API

`invoke()` (`CommandPalette.tsx`) gates by kind:

- `error` — returns immediately, never invoked.
- `task` — navigation only. **No active task or terminal API required**; calls `activateTaskSignals`
  + `navigate(pathForTask(t))`.
- `action:pane-*` (Show/Close pane) — dispatch a layout action; needs an active task but **not** the
  terminal API.
- `run`, `workflow`, `layout`, and the remaining actions (`new-terminal`, `toggle-terminal`,
  `archive`) — need both an active task **and** the terminal API (`if (!taskId || !api) return`).

**Bridge gating.** The run/layout/workflow rows come from `terminalApi()` resources
(`api.run.targets`, `api.workflow.defs`). The terminal API only exists when the desktop preload
bridge is present (`capabilities()`, `features/capabilities.ts`), so in a plain browser (`dev:node`)
those three kinds are simply absent and the palette shows only pane/task/archive actions. See
`docs/terminal-and-agents.md` and `docs/workflows.md`.

### Fuzzy matching (`fuzzyScore` / `fuzzyFilter`)

`fuzzyScore(query, text)` is a **subsequence** match: every query char must appear in `text` in
order (case-insensitive). Non-matches return `null`. Scoring rewards structure:

- **+3** when a hit is contiguous with the previous hit (a run).
- **+2** when a hit is at position 0 or follows a word-boundary char (`/[\s:./-]/`) — a word start.
- **+1** otherwise.

An empty query scores `0` (everything passes). `fuzzyFilter` maps items to scores, drops the `null`s,
sorts descending by score, and returns the surviving items. It matches on the item **label** only
(`model.ts:35`) — hints are display-only.

`fuzzyScore` is shared: `FilePalette` reuses it to rank worktree paths (capped to `MAX_ROWS`), and
the `/` changed-file finder reuses it to rank a PR's changed paths.

### Overlay keyboard

The palette's `window` listener comes from `createOverlayPalette`:

- **⌘K / Ctrl+K** — toggle open/closed (the hook's `isToggle`). On open it refetches run targets
  **and** workflow definitions and focuses the input (the run/workflow resources also key off
  `open()`, so they load lazily — nothing is fetched while the palette is closed).
- **↑ / ↓** — move selection (clamped to the list).
- **Enter** — invoke the selected item.
- **Esc** — close and clear the query.
- Hovering a row sets the selection; clicking invokes it. Clicking the backdrop closes.

## 2. File finder (⌘P)

`FilePalette.tsx` is a fuzzy **go-to-file** across the active task's git worktree. Monaco has no
built-in file finder (that's a VS Code workbench feature, not the editor core), so this reuses the
same palette shell and `fuzzyScore` over `git ls-files` (fetched via `editorApi().files(taskId)`
over IPC).

- Requires an active task; ⌘P is a no-op with no task selected.
- Empty query lists the first `MAX_ROWS = 100` files; a query fuzzy-ranks and caps to 100
  (`ponytail:` — big repos have thousands of files, cap the render).
- Picking a file dispatches a layout `show` for the `editor` pane and calls
  `editorOpen(taskId, path, true)` — an **ephemeral preview tab**, the same as a single click in the
  file tree. See `docs/panes.md` (Editor).
- Rows show the basename emphasized with the directory as a dim hint.
- Keyboard mirrors the command palette: ⌘P toggles, ↑/↓ move, Enter picks, Esc closes.
  `preventDefault` on ⌘P blocks the browser print dialog since Monaco binds nothing there.

### `/` — the in-PR changed-file finder (distinct)

Do not confuse ⌘P with `/`. The `/` finder lives in `Shortcuts.tsx` and searches **only the changed
files of the currently open PR** (same source/order `PullDetail` uses — both go through the shared
`useChangedFiles` hook, `client/changedFiles.ts`), not the whole worktree. Selecting a file sets
`?file=` for the diff view rather than opening an editor tab. Results are ranked with the palette's
`fuzzyScore` (highest score first; ties keep the PR's file order, and an empty query lists all files
in PR order) — and the finder only opens when a PR route is active. Finder state is per PR:
navigating to a different PR clears the filter and closes the overlay, though `?file=` itself
survives as the diff's scroll target. Keyboard is the shared overlay hook's: ↑/↓ clamp, Enter
picks, Esc closes.

| | ⌘P (`FilePalette`) | `/` (`Shortcuts`) |
| --- | --- | --- |
| Scope | Active task's whole worktree (`git ls-files`) | Changed files of the open PR only |
| Action | Opens an ephemeral **editor tab** | Sets `?file=` in the **diff view** |
| Available when | A task is active | A PR route is open |

## 3. Global keyboard shortcuts

The canonical reference is the `SHORTCUTS` array in `Shortcuts.tsx`, rendered verbatim by the
Settings → Shortcuts tab:

| Key | Action |
| --- | --- |
| `⌘1 – ⌘9` | Jump to task 1–9 in the rail |
| `⌘K` | Command palette (panes, tasks, run targets) |
| `⌘P` | Go to file in the task worktree |
| `j / k` | Next / previous PR |
| `[ / ]` | Previous / next file |
| `/` | Find file in this PR |
| `c` | Create pull request |
| `?` | Open keyboard shortcuts |
| `Esc` | Close overlay |

Plus one that isn't in the table because it's owned by the Electron main process:

| Key | Action |
| --- | --- |
| `⌘W / Ctrl+W` | Close the focused editor file / terminal tab (not the window) |

### Ownership

Shortcuts are deliberately scattered to the component that owns the relevant state — there is no
global keymap:

| Key(s) | Owner |
| --- | --- |
| `⌘1–9` | `TabRail.tsx:103` — jumps to the Nth **visible** task (workspace-scoped + rail order). |
| `j / k` | `PullList` — next/previous PR. Left untouched by `Shortcuts.tsx` on purpose. |
| `⌘K` | `CommandPalette.tsx` (standalone). |
| `⌘P` | `FilePalette.tsx` (standalone). |
| `/`, `[`, `]`, `c`, `?`, `Esc` | `Shortcuts.tsx` — the finder overlay + file cycling + create-PR + open-help. |
| `⌘W / Ctrl+W` | Main process `before-input-event` (`electron.ts:98`) → IPC `acorn:close-pane`. |

### Typing & modifier rules

`Shortcuts.tsx` enforces two rules for its bare-key shortcuts:

- **All shortcuts except `Esc` are ignored while typing.** The shared `isTypingTarget` guard
  (`client/lib/isTypingTarget.ts`, also used by TaskView's pane shortcuts) covers form fields
  (`input` / `textarea` / `select`) **and** `contentEditable` surfaces like the notes pane. `Esc`
  always closes the finder, even from inside its own input.
- **Modifier chords are left to the OS/browser** — if `metaKey`, `ctrlKey`, or `altKey` is held, the
  bare-key handler bails (so ⌘C copies, etc.).

`⌘1–9` and `⌘W` are the exceptions: they are meta/ctrl combos, so they stay active even while typing
(`TabRail.tsx:100` notes the combo is safe to leave on). `⌘1–9` additionally bails if Alt or Shift is
held, so OS-level chords like ⌘⇧1 pass through untouched.

### ⌘W close-pane flow

A menu accelerator can't be suppressed from the page, so main intercepts ⌘/Ctrl+W in
`before-input-event`, calls `e.preventDefault()`, and sends `acorn:close-pane` over IPC
(`electron.ts:98`, `preload.ts:11`). The **renderer decides what "focused pane" is**: both
`EditorPane.tsx:48` and `TerminalPanel.tsx:76` subscribe via `window.acorn.onClosePane`, and each
acts only if `document.activeElement` is inside its own pane — closing the active editor tab or the
active terminal tab respectively. If neither owns focus, nothing closes (this is a single-window app;
⌘Q quits).

## 4. Pane shortcuts (Task view)

`apps/desktop/src/client/features/tasks/paneShortcuts.ts` defines **single bare keys** that switch
panes inside the Task view. Most dispatch a layout `show`; `agents` and `terminal` are toggles, not
layout panes. Defaults (`PANE_SHORTCUT_DEFAULTS`):

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `r` | PR review | `e` | Editor |
| `g` | Changes | `l` | Linear |
| `n` | Notes | `o` | Rollbar |
| `x` | Context | `a` | Agents (toggle) |
| `b` | Browser preview | `t` | Terminal (toggle) |

These are active **only in the Task view** (the listener lives for that component's lifetime,
`TaskView.tsx`) and follow the app's bare-key convention (like `j`/`k`/`c`). The handler guards
typing targets — including `contentEditable` surfaces like the notes pane — and modifier chords,
same as the global handler. Some panes are availability-gated: `r` (PR review) is a no-op when the
task has no PR, and `l`/`o` are no-ops when the task has no Linear/Rollbar links. The defaults are
chosen to dodge the global bare-key shortcuts.

### Overriding & reserved keys

Bindings are overridable via the `pane_shortcuts` pref — a JSON `Record<PaneAction, key>` edited in
Settings → Shortcuts. `paneKeys()` merges overrides over defaults; `paneKeymap()` builds the reverse
key→action map (first definition wins on a collision). Each override value must be a single
character.

Seven keys are **reserved** and can't be reassigned to a pane because the global handler / PullList
already own them (`RESERVED_KEYS`, `paneShortcuts.ts:23`):

```
c   j   k   ?   /   [   ]
```

## 5. Settings → Shortcuts tab

Opened by pressing `?` anywhere (`Shortcuts.tsx` calls `onOpenShortcuts`, which `App.tsx:443` wires
to `openSettings('shortcuts')`). The tab (`SettingsModal.tsx:209`) has two sections:

- **Panes** — an editable list of `PANE_SHORTCUT_DEFAULTS`. Each row is a read-only input; click it,
  then press a key. `captureKey` (`SettingsModal.tsx:63`) rejects non-single keys, rejects
  `RESERVED_KEYS` ("… is reserved by a global shortcut"), and rejects collisions with another pane
  ("… is already used by <label>"), then persists an override diff into `pane_shortcuts`. A **Reset
  panes to defaults** button writes `{}`.
- **Global** — the `SHORTCUTS` array rendered read-only as a reference (the global keys aren't
  rebindable).

The pane-switcher tooltip in the Task view shows the *effective* key (override or default) so it
always matches what's bound.

---

**Source:** `apps/desktop/src/client/features/palette/{model.ts,overlay.ts,CommandPalette.tsx,FilePalette.tsx}`
· `apps/desktop/src/client/Shortcuts.tsx` · `apps/desktop/src/client/changedFiles.ts` ·
`apps/desktop/src/client/lib/isTypingTarget.ts` ·
`apps/desktop/src/client/features/tasks/paneShortcuts.ts`
· `apps/desktop/src/client/features/tabs/TabRail.tsx` ·
`apps/desktop/src/client/features/settings/SettingsModal.tsx` · main-process close-pane
`apps/desktop/src/main/{electron.ts,preload.ts}`.

**See also:** [frontend.md](./frontend.md) · [panes.md](./panes.md) ·
[workflows.md](./workflows.md) (run targets / layout recipes) ·
[terminal-and-agents.md](./terminal-and-agents.md) ·
[workspaces-and-tasks.md](./workspaces-and-tasks.md).
