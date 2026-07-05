# Panes

How the Task view is laid out, and what every pane does. A **pane** is a surface inside the Task view
(the single-repo unit of work — repo + branch + optional worktree + optional PR). A task's layout is a
flat left→right row of open panes; one pure reducer owns every transition. This doc covers the pane
model and a catalog of all eight panes, plus the two non-pane surfaces that render over the task view.

For where the Task view sits in the app, see [frontend.md](./frontend.md) and
[workspaces-and-tasks.md](./workspaces-and-tasks.md).

## The pane model

A layout is just an ordered list of pane ids:

```ts
type PaneId = 'pr' | 'linear' | 'rollbar' | 'preview' | 'editor' | 'changes' | 'notes' | 'context'
type TaskLayout = { panes: PaneId[] } // left→right, at least one, no duplicates
```

There is no separate `browser` pane — agent-driving is a capability of `preview` (see the catalog
below). Configs/prefs that still name unknown pane ids are tolerated: `isPaneId` filters them out
wherever layouts are parsed (`normalizeLayout`, `recipeToLayout`).

There is **no split-tree** — panes open side by side in equal-width slots, nothing more.
`apps/desktop/src/client/features/tasks/layout.ts:4` marks this as a deliberate simplification
(`ponytail: a flat panes[] row, not a LayoutNode tree`).

### The reducer

Every layout change goes through one pure function, `applyLayoutAction`
(`layout.ts:37`), driven by four actions:

| Action | Trigger | Effect |
| --- | --- | --- |
| `show` | switcher click | replace the row with just that pane |
| `add` | ⌘/Ctrl-click a switcher icon | append the pane to the right (no-op if already open) |
| `close` | a slot's ✕ button | drop the pane; if it was the last, fall back to `DEFAULT_PANE` (`pr`) |
| `replace` | recipe seeding | swap in a whole validated layout |

The reducer is the single writer. `TaskView` never mutates the row directly — it calls
`dispatchLayout(taskId, action)` (`features/tasks/tasks.ts:26`), which runs the reducer and persists
the result. `layoutForTask(taskId)` reads the current layout; a task with none falls back to
`defaultLayout()` (`TaskView.tsx:41`).

### Persistence & migration

Layouts are stored per task in the `task_layouts` pref (a `Record<taskId, TaskLayout>`, hydrated in
`App.tsx`). `normalizeLayout` (`layout.ts:64`) defensively re-validates persisted values so prefs
survive schema evolution: it tolerates two earlier shapes — the legacy `{ panes, pinned, ratio }` slot
model and the short-lived `{ active, pinned[] }` pin model — collapsing both into the flat `panes[]`
row, dropping unknown/duplicate pane ids. `parseTaskLayouts` falls back to the even older `task_panes`
pref (`Record<taskId, PaneId>`) via `migrateTaskPanes` when no `task_layouts` value exists.

### The switcher

The right-edge `nav.pane-switcher` (`TaskView.tsx:313`) holds one glyph button per available pane,
plus toggles for Agents (`⠿`) and the Terminal (`>_`), the per-target run buttons (`▶`/`■`), and the
Close-task `✕`. Interaction rules:

- **Click** → `{ type: 'show', pane }` (replace to a single pane).
- **⌘/Ctrl-click** → `{ type: 'add', pane }` (open beside the current panes).
- Each open slot shows a **close button** only when more than one pane is open (`CloseBtn`,
  `TaskView.tsx:48`).
- Provider panes appear conditionally: `pr` only when the task has a linked PR, `linear`/`rollbar`
  only when the task has links of that provider.
- Tooltips show the effective keyboard key (`data-tip-key`) and a one-line hint.

The command palette exposes the same transitions as `Show pane: …` / `Close pane: …` rows (full
`PaneId` set), so panes are reachable without the mouse — see
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) and
`features/palette/CommandPalette.tsx:46`.

### Keyboard shortcuts

`features/tasks/paneShortcuts.ts` defines bare single-key shortcuts, scoped to the task view by a
window listener in `TaskView` (`onPaneKey`, `TaskView.tsx:182`) that ignores text-entry targets and
modifier chords. Defaults:

| Key | Target | | Key | Target |
| --- | --- | --- | --- | --- |
| `r` | PR review | | `e` | Editor |
| `g` | Changes | | `l` | Linear |
| `n` | Notes | | `o` | Rollbar |
| `x` | Context | | `a` | Agents (toggle) |
| `b` | Browser preview | | `t` | Terminal (toggle) |

`agents` and `terminal` are toggles, not layout panes; the rest dispatch a `show`. Keys are
overridable via the `pane_shortcuts` pref (Settings → Shortcuts); `paneKeys`/`paneKeymap` resolve
override-else-default and the switcher tooltip shows the effective key. `RESERVED_KEYS`
(`c j k ? / [ ]`, `paneShortcuts.ts:23`) are owned by the global handler and PullList and can never be
assigned to a pane.

### Layout recipes

A recipe (`features/tasks/recipes.ts`) is a `[layout.<id>]` config block that seeds a whole layout in
one shot. `invokeLayoutRecipe` (`recipes.ts:31`), a pure executor over injected services:

1. `recipeToLayout` turns the recipe's `panes` into a validated `TaskLayout` (unknown/duplicate panes
   dropped) and applies it via `replace`.
2. If `terminal: "run.<id>"` is set, it auto-starts that run target in the terminal drawer and opens
   the drawer.
3. If `browser: "run:<id>"` is set, it ensures the target is up, resolves its URL, and points the
   browser/preview pane at it (`setBrowserUrl`).

The recipe's old `ratio` field is gone (main's parser stopped emitting it and the client type
followed) — panes always split equally. Recipe-resolved browser home
URLs live in a separate signal (`recipeBrowserUrl`, `tasks.ts:64`) that wins over the workspace's
configured preview URL for that session. Recipes are designed in `docs/next/13 §C`; run targets are
covered in [terminal-and-agents.md](./terminal-and-agents.md).

---

## The pane catalog

Each pane is rendered by `paneBody(pane)` in `TaskView.tsx:251`. PR is the only pane with internal
structure (a navigator + a diff, two sections in one slot); every other pane is a single section.

### `pr` — PR review

The default pane, shown only when the task has a linked PR (`hasPr()`). It renders two components side
by side inside the slot (`TaskView.tsx:252`):

- **Navigator** — `PullDetail.tsx`. The PR header (state/draft badge, author, base←head branch chips,
  file/±line summary, updated-age) with the merge/close/draft/reopen/auto-merge **review actions**;
  then collapsible sections (state persisted in `localStorage`, `PullDetail.tsx:44`) for Description,
  Integrations (Linear tickets scanned from the PR body/comments/reviews/threads — opens a
  `LinearIssuePanel`), Labels (add/remove via `Picker`), the **changed-file list** (per-file status,
  ±stats, viewed checkbox — clicking a file scrolls the diff to it), Checks (status dots; a check name
  opens the [ChecksPanel](#checkspanel-non-pane), a failed check offers Rerun), the **conversation
  timeline** (merged comments/commits with an inline composer + threaded review replies), and Review
  (requested reviewers + approve / request-changes / comment).
- **Diff** — `DiffView.tsx`. A virtualized Shiki-highlighted diff with split/unified toggle, inline
  review threads (reply/resolve), gap expansion, and viewed-marking. The diff rendering pipeline is
  documented in full in [diff-rendering.md](./diff-rendering.md).

Source: `PullDetail.tsx`, `DiffView.tsx`, `features/pullDetail/`, `features/diff/`.

### `changes` — local working-tree review

A PR-style "Files changed" view over the task worktree's **uncommitted** changes
(`features/changes/ChangesPane.tsx`). It reuses the same diff pipeline as `pr`, but fed by local git
IPC (`local.changes` / `local.diff`) instead of GitHub patches; the whole-file view (`-U1e6`) drops
expand-gaps and hunk headers so every line shows with +/- highlights. It refreshes on the rail's
dirty-poll signal (`taskStatus`). Needs a worktree, so it is terminal-flag territory (see
[terminal-and-agents.md](./terminal-and-agents.md)).

Interactions:

- Staged / unstaged file groups; per file **stage** (`+`), **unstage** (`−`), and **discard** (`↺`,
  destructive → explicit confirm); **Commit staged** with a message; **Push → origin** (`git push -u
  origin HEAD`).
- **Review notes** — inline annotations anchored to a diff line (shared line composer), rendered under
  their anchor. **Send N notes → agent** bundles the unsent notes into one prompt via `sendToAgent`
  (`after-ready` — queued until the agent idles), then stamps them sent (`ChangesPane.tsx:146`).
- **→ agent** on a file, or **⌥-click** a line, drops a `path[:line]` reference into the agent
  composer (`sendReferenceToAgent`).

Source: `features/changes/ChangesPane.tsx`, `features/changes/model.ts`, `shared/reviewPrompt.ts`.

### `notes` — markdown notes

`.md` notes at two scopes (`features/notes/NotesPane.tsx`): **this workspace** (shared by every task in
the group) and **Global** (shared across all workspaces), rendered together and grouped so the
distinction is visible; you pick the scope when creating. A list + textarea editor with a
preview/edit toggle (sanitized markdown) and **autosave** (debounced, flush on blur and note-switch —
no Save button). `ponytail: textarea over TipTap`.

Humans only ever create `scratch` notes here; `plan` / `finding` / `handoff` notes are written by
agents and workflows (workspace scope) and surface under a collapsible **Agent notes** group with
author (`🤖`/`⚙`) and kind badges. The Context pane's "Edit note" jump opens a slug here in editable
state (`requestNoteOpen` → `noteToOpen`). See [notes-and-memory.md](./notes-and-memory.md).

Source: `features/notes/NotesPane.tsx`, `features/notes/notesClient.ts`.

### `context` — assembled context

Everything attached to the task in one place (`features/context/ContextPane.tsx`): the PR (with body +
changed files), linked issues/errors, notes, and top memories — each with an **include checkbox** and
a per-item expand. **Assemble & send → agent** re-fetches the task context with the curated `include`
set, formats it (`formatContextBlock`), and sends it to the task's agent (`after-ready`, gated on the
idle edge). The pane also hosts `MemoryTray` (`features/memory/MemoryTray.tsx`) — the memory
workflow lives there: **review/accept/reject** of auto-generated memory proposals (accept optionally
edits the description; verification `flags` render as warning badges beside the row) and a manual
**+ memory** form (repo scope → the task worktree; private scope → `~/.acorn/memory`). See
[notes-and-memory.md](./notes-and-memory.md).

Source: `features/context/ContextPane.tsx`, `features/context/model.ts`, `shared/contextBlock.ts`,
`features/memory/MemoryTray.tsx`, `features/memory/memoryClient.ts`.

### `editor` — in-app code editor

A Monaco editor over the task worktree (`features/editor/EditorPane.tsx`): a lazy file tree on the
left, a **tab bar** driving **one reused Monaco instance** on the right. Single-click opens an
ephemeral (italic) preview tab; editing or double-click promotes it. **⌘S** flushes a save and
**autosave** runs on a debounce (blur / tab-switch / close); a **dirty dot** marks unsaved tabs.
Because the agent and human share the worktree, a **reload-on-focus guard** silently reloads clean
models from disk but never clobbers a dirty one (`EditorPane.tsx:142`). **⌘/Ctrl+W** closes the active
tab when focus is inside the pane (main suppresses the window-close accelerator and pings the
renderer; the focus-containment subscription is the shared `onClosePaneWithin` helper in
`client/lib/`, also used by the terminal drawer).
**→ agent** adds a file (or selection) reference to the agent composer. Open files persist to the
`editor_open_files` pref (`features/editor/editorState.ts`).

Source: `features/editor/EditorPane.tsx`, `features/editor/editorState.ts`,
`features/editor/editorClient.ts`.

### `linear` — Linear ticket(s)

The task's linked Linear ticket(s). The switcher `◷` shows only when the task has ≥1 Linear link;
the pane renders `LinearIssuePanel` **in its layout slot** (`variant="pane"`) like the other
provider panes, showing title, state, description, activity log, and threaded comments with an
inline reply box + composer. With several linked tickets it shows a **chip strip** to switch
between them (`identifiers` / `onSelectIdentifier`). The same component still serves PullDetail's
Integrations section as a right-anchored overlay (its original variant). See
[integrations.md](./integrations.md).

Source: `features/integrations/LinearIssuePanel.tsx`.

### `rollbar` — Rollbar error(s)

The task's linked Rollbar error(s) (`features/integrations/RollbarPane.tsx`): resolves `task_links` →
the `/api/rollbar` detail route and shows level, title, status, environment, occurrence count, and
first/last-seen. A **chip strip** switches between several linked items (mirroring the Linear panel).
See [integrations.md](./integrations.md).

Source: `features/integrations/RollbarPane.tsx`.

### `preview` — browser preview (agent-drivable)

A live `<webview>` onto the workspace's / run-target's resolved URL, wrapped in browser chrome —
back / forward / stop-reload / home + an editable URL bar + a loading spinner
(`features/preview/PreviewPane.tsx`, its own feature folder like every other pane body). The home
URL (`previewUrl()` in `TaskView.tsx`) resolves in priority order: a layout recipe's
`browser=run:<id>` resolution → the default run target's resolved URL → the legacy per-workspace
preview config (url / port / script mode) → the dev-server port. One `<webview>` is kept per task
so page/scroll/form state survives pane and task switches (`previewWebviews`); archiving a task
evicts its entry (`evictPreviewWebview`, called by every archive path) so dead webviews don't
accumulate over a session. The main process's `will-attach-webview` guard keeps it to http(s).
Preview needs a resolvable URL (a configured run target / workspace preview), so it only does its
full job on desktop.

**Agent driving is a capability of this same pane**, not a separate `browser` pane: when the
webview reaches `dom-ready`, `PreviewPane` binds its `webContents` id to the main process
(`window.acorn.browser.bind`) so an agent can drive it over CDP via the MCP `browser_*` tools
(`browser_navigate`, `browser_click`, `browser_snapshot`, …) — see [mcp.md](./mcp.md). One webview
surface, two entry points (human chrome vs. agent driving).

Source: `features/preview/PreviewPane.tsx`, `src/mcp/server.ts`.

---

## Related non-pane surfaces

Two surfaces render *over* the task view rather than as layout slots.

### ChecksPanel {#checkspanel-non-pane}

A right-anchored overlay opened from PullDetail's Checks section (`features/checks/ChecksPanel.tsx`),
showing one Actions workflow run's job steps GitHub-Actions style: failed steps start expanded, and
each step's log is sliced from a single lazy job-log fetch and ANSI-highlighted. Not a pane — it opens
and closes within the `pr` pane.

### Agents panel

The right rail roster + launcher + activity feed for agent sessions, toggled by the `⠿` switcher
button or the `a` key (`agentsOpen`, `TaskView.tsx:354`; `features/agents/AgentsPanel.tsx`). It lists
PTY sessions and workflow steps, launches new agents, shows per-agent feeds and inline gate prompts,
and can resume a step as a raw TUI in the terminal drawer. It is a toggle, not a layout pane. Full
detail in [terminal-and-agents.md](./terminal-and-agents.md).

> **Maturity:** the terminal drawer, agent sessions, run targets, and workflows are desktop-only —
> always on when the preload bridge is present (`capabilities()`, `features/capabilities.ts`; the
> old `acorn:term` flag is gone). Panes that depend on a worktree or an agent (`changes`, `editor`,
> `context`'s send, `notes`' agent groups, `preview` targets, the Agents panel) therefore only do
> their full job on desktop; in a plain browser session (`dev:node`) the bridge is absent and they
> degrade. PR review, Linear, and Rollbar panes work without it.

## Source

- Model & reducer: `apps/desktop/src/client/features/tasks/layout.ts`
- Layout state / dispatch / persistence: `apps/desktop/src/client/features/tasks/tasks.ts`
- Task view & switcher: `apps/desktop/src/client/features/tasks/TaskView.tsx`
- Pane shortcuts: `apps/desktop/src/client/features/tasks/paneShortcuts.ts`
- Recipes: `apps/desktop/src/client/features/tasks/recipes.ts`
- Pane bodies: `apps/desktop/src/client/features/{pullDetail,diff,changes,notes,context,editor,integrations,memory,preview,agents,checks}/`

See also: [frontend.md](./frontend.md) · [diff-rendering.md](./diff-rendering.md) ·
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) ·
[notes-and-memory.md](./notes-and-memory.md) · [terminal-and-agents.md](./terminal-and-agents.md) ·
[integrations.md](./integrations.md) · [mcp.md](./mcp.md) ·
[workspaces-and-tasks.md](./workspaces-and-tasks.md)
</content>
</invoke>
