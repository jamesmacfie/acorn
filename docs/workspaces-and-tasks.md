# Workspaces & Tasks

acorn's core organizing model: two tiers. A **Workspace** is a named *group of repos*; a **Task** is
the single-repo *unit of work* (a branch + optional worktree + optional PR + its panes). This
describes what the code does today. (The original design docs, `docs/workspaces/`, have been
removed — see git history for the rationale and alternatives considered.)

## The two-tier model

| Tier | What it is | Scope | Key table |
| --- | --- | --- | --- |
| **Workspace** | A named group of repositories ("Runn", "Acorn"). The top-level unit picked in the top bar. Carries identity (colour + icon) and per-workspace scripts + browser-preview config. | A repo belongs to **exactly one** workspace (a partition). The active workspace is **derived** from the current repo — there is no URL/routing dimension and nothing stores "the selected workspace". | `workspaces` |
| **Task** | The single-repo unit of work: repo + branch + optional git worktree + optional linked PR + its panes/terminals. Shown as a row in the left **TabRail**. | Bound to one repo; its parent workspace is derived through `workspace_repos` on `(repoOwner, repoName)`. | `tasks` |

Selecting a workspace is not stored — it is inferred. `workspaceForRepo` (`apps/desktop/src/core/client/workspaces/activeWorkspace.ts:6`) returns whichever workspace contains the current repo, and switching workspace simply means navigating to one of its repos.

### Terminology note (old docs vs. today)

The original design docs (the removed `docs/workspaces/`) were written when **"Workspace" meant a
single unit of work** (one repo + branch + PR + worktree + terminals). That entity was renamed
**Task**, and "Workspace" was repurposed to mean the *group of repos*.

| Concept | Old design-doc name | Current name |
| --- | --- | --- |
| One repo + branch + PR + worktree + terminals (a rail row) | "Workspace" | **Task** |
| A named group of repos (top selector) | — (did not exist) | **Workspace** |

When reading anything from that era (old commits, the removed design docs), mentally substitute
"Workspace → Task" unless the text clearly means the group.

---

## Workspaces

### Identity

Every workspace has a colour and an icon, both with deterministic derived defaults so a workspace looks
distinct before the user ever picks anything. The helpers are pure and shared between the Hono routes
and the renderer (`apps/desktop/src/core/shared/workspaceIdentity.ts`).

- **Colour** (`workspaces.color`): a preset token key (`green`, `blue`, `purple`, `orange`, `red`,
  `teal`, `magenta`, `gray`) or a 6-hex value (with or without `#`). `null` → derived from a hash of
  the name (`defaultWorkspaceColor`). The app palette is otherwise greyscale, so these are the only
  chromatic tokens. `resolveWorkspaceColor` resolves stored → CSS colour.
- **Icon** (`workspaces.icon`): a validated JSON union stored as text — `{"kind":"emoji","value":"🌰"}`,
  `{"kind":"lucide","value":"…"}`, or `{"kind":"github"}`. `null` → a derived default. Parsing is
  defensive: a malformed value degrades to `null` rather than throwing (`parseWorkspaceIcon`).

The workspace colour surfaces as a 3px left accent on its Task rows in the rail, and an emoji icon (if
set) is used as the row glyph (see [TabRail](#the-tabrail) below).

### Per-workspace scripts & preview config

A workspace owns the lifecycle scripts that run against each of its Task worktrees, plus how the
browser-preview pane resolves its URL. All are nullable (blank ⇒ `null` ⇒ "none"). Columns on
`workspaces`:

| Column | Purpose |
| --- | --- |
| `setupScript` | Shell command run once when a Task worktree is created; null/blank = none. |
| `setupScriptTrigger` | `off` \| `created` \| `terminal` — *when* the setup script runs; null → `terminal`. |
| `devScript` | Per-workspace "run dev" command → a `dev` run target; null/blank = no run button. |
| `devRestartScript` | Restart command for the `dev` target; when set, `run_restart` runs it instead of stop+start. |
| `teardownScript` | Shell command run in the worktree just before removal (on archive); null/blank = none. |
| `previewMode` | `url` \| `port` \| `script` — how the browser-preview URL is resolved; null → dev-server port. |
| `previewValue` | The URL, port, or shell command per `previewMode`; null/blank = unset. |

The `PATCH /api/workspaces/:id` route validates these: `setupScriptTrigger` must be one of the three
values, `previewMode` one of the three modes, and — importantly — a `port` preview value must be a bare
1–65535 port so a crafted value (e.g. `@evil.com`) can't redirect the preview webview to another host
(`apps/desktop/src/core/server/routes/workspaces.ts`). Terminal/agent/run-target behaviour that consumes
these scripts is desktop-only — it needs the main-process worktree capability (see
[Lifecycle](#lifecycle-note)).

### The Default workspace & bootstrap

On first login a single **Default** workspace (`isDefault = true`) is created and every mirrored repo
not already assigned (and not ignored) is placed in it. This is `POST /api/workspaces/bootstrap`
(`apps/desktop/src/core/server/routes/workspaces.ts:60`) — **idempotent**: it re-runs safely, skipping repos
already mapped or ignored, so an ignored repo never silently reappears in Default. `ensureDefault`
lazily creates the Default row if it is missing.

Deleting a non-default workspace reassigns its repos back to Default (rather than orphaning them) and
drops its external-project links; the Default workspace itself cannot be deleted.

### Onboarding & repo assignment

The repo→workspace mapping UI is a single shared body, `WorkspaceRepoAssignments`
(`apps/desktop/src/core/client/workspaces/WorkspaceRepoAssignments.tsx`), rendered both by the
first-run `OnboardingModal` and by Settings → Workspaces. It lets you:

- **Create** workspaces inline (name field → `POST /api/workspaces`).
- **Assign** each repo to exactly one workspace via a dropdown. Assignment is an upsert on
  `(owner, repo)` and *also clears any ignore flag* — assigning a repo un-hides it
  (`POST /api/workspaces/:id/repos`).
- **Map the on-disk checkout** (desktop only): a "Browse…" button opens a native folder picker
  (`api.repoPath.pick()`) and records the path in `repo_paths` (joined to the workspace by
  `(owner, repo)` — the path is *not* stored on `workspace_repos`).
- **Hide repos** with a per-row eye toggle, plus a master toggle to hide/show all. Hiding writes an
  `ignored_repos` row (the top-level `POST /api/workspaces/ignore-repo` / `unignore-repo` /
  `ignore-all` routes — not nested under `:id`, since ignoring is repo-global, not per-workspace).

An **ignored** repo keeps its `workspace_repos` membership but is excluded everywhere from the main UI
(selector, rail, scoping) — `listWorkspaces` and `GET /assignments` share the `ignoredRepoSet(db)`
helper (`workspaces.ts`) to filter/flag them. The onboarding modal still lists it (it iterates *all* mirrored repos), so
it can be re-assigned to bring it back. The `GET /api/workspaces/assignments` endpoint returns every
mapped repo's `{ workspaceId, ignored }` so a hidden (greyed) row still shows which workspace it belongs
to. `OnboardingModal` writes the `onboarded` pref on "Done" so it doesn't reappear.

### External-project links (`workspace_projects`)

A workspace can link external projects (Linear/Rollbar) so one project backs *every repo in the
workspace* — one project → many repos falls straight out of the grouping. Each link is a
`(workspaceId, integrationId, externalId)` triple: `integrationId` records *which connection* the
project belongs to, so a workspace can link projects across several integrations (e.g. two separate
Linear connections). This generalizes the old per-repo `linear:projects:{owner}/{repo}` pref and the
old `workspace_linear_projects` table into a provider-agnostic store.

Read/write via `GET`/`PUT /api/workspaces/:id/projects`. The `PUT` replaces the whole set
(clear-then-insert — the simplest correct approach for a composite key; marked `ponytail` in the
source). The Linear browse pane's project picker is the primary writer (see
[Sources & browse](#sources--browse)).

---

## Tasks

### The data (`tasks`)

A Task is machine-scoped (it owns a local worktree) — no `user_id`. Its parent workspace is derived, not
stored. Columns (`apps/desktop/src/core/server/db/schema.ts:341`):

| Column | Meaning |
| --- | --- |
| `id` | Opaque uuid. |
| `title` | Editable label; seeded from the origin (PR title, ticket id + title, `repo · branch`). |
| `origin` | `github-pr` \| `linear` \| `rollbar` \| `local` — where the task came from. |
| `repoOwner`, `repoName` | The repo this task belongs to (always set). |
| `branch` | The branch this task works on. |
| `worktreePath` | Path to its git worktree; **null until a terminal is first opened** (Flow C). |
| `pullNumber` | Linked PR number; **null for local-first tasks until a PR is inherited** (Flow B). |
| `status` | `active` \| `archived`; workflow-created child tasks may be `cancelled`. |
| `parentId` | Task-tree lineage — set on fan-out children; null = root (workflow feature, design-stage). |
| `sort` | Rail ordering seed, like `pinned_repos.sort`. **Not** the visible order (see `rail_order` below). |
| `createdAt`, `updatedAt`, `archivedAt` | Epoch **milliseconds**. `archivedAt` is set on archive; the row is kept for history/teardown audit. |

`GET /api/tasks` returns only `active` tasks, ordered by `sort`, each with its `task_links`. Task titles
are seeded server-side when omitted: `#<pr> <repo>` when a PR number is present, else `<repo> · <branch>`
(`apps/desktop/src/core/server/routes/tasks.ts:56`).

### How tasks are created

All three UI paths call `POST /api/tasks` with a `TaskSeed` (`origin`, `repoOwner`, `repoName`, `branch`,
optional `title`, `pullNumber`, `links`):

- **From a PR** (`origin: github-pr`) — created from a PR row/detail; `pullNumber` set at birth.
- **From a Source browse** (`origin: linear` | `rollbar`) — promoting a Linear issue or Rollbar error
  (see below). The branch defaults from the issue (`LinearProjectIssue.branchName` or the lowercased
  identifier for Linear; a slug of the error title for Rollbar), and the item is recorded as a
  `task_link`.
- **Local-first** (`origin: local`) — the "New task" (`+`) button in the rail. Opens a small modal
  (Electron's `BrowserWindow` has no `window.prompt`) that picks a repo from the active workspace and a
  branch. The branch defaults to a de-duped slug of the title (`slugifyBranch` + `dedupeBranch`,
  `apps/desktop/src/core/shared/branch.ts`) until the user edits the branch field, then their value wins
  (`TabRail.tsx:62`).

### External links (`task_links`)

Zero-or-more external items a task references (Linear tickets, Rollbar errors). Each link is
`(taskId, integrationId, identifier)` with `provider` denormalized for cheap filtering. `integrationId`
pins the item to a specific connection (two Linears could each have an `ENG-42`), and
`(integrationId, identifier)` matches the PK tail of the `issues` cache so a link resolves straight to
cached detail. Links grow and shrink after creation (`POST`/`DELETE /api/tasks/:id/links`), so a task
accumulates context as work unfolds — e.g. Rollbar's "＋task" attaches an error to the *current* task
rather than creating a new one (`RollbarBrowse.tsx:68`).

### Flow B — PR inheritance

A local-first task (no `pullNumber`) **adopts a PR** once one is opened for its branch. On a real PR-list
refresh (not a 304), the pulls route builds a `branchName → number` map from the just-mirrored PRs and,
for every active no-`pullNumber` task in that repo, sets `pullNumber` when its branch matches
(`apps/desktop/src/plugins/github/server/routes/pulls.ts:142`). No webhook, no polling loop — it piggybacks on the
normal mirror sync. After inheritance the task's PR pane and checks light up automatically.

(The complementary flows: **Flow A** = task born from an existing PR; **Flow C** = the worktree is
created lazily on first terminal — see [Lifecycle](#lifecycle-note).)

---

## The TabRail

The left rail (`apps/desktop/src/core/client/tabs/TabRail.tsx`) has two zones separated by a rule:

1. **Sources** (top) — browse entry points. GitHub is always present; Linear and Rollbar appear only
   when a connected integration of that provider exists (`availableSources`,
   `apps/desktop/src/core/client/tabs/sources.ts`). Selecting a Source fills the main area with that
   provider's browse view and clears the active task.
2. **Tasks** (below) — one row per active Task, **scoped to the active workspace**: tasks whose repo
   isn't in the current workspace are hidden, so switching workspace swaps the roster (`TabRail.tsx:75`).

### Row decorations

Each Task row carries live status glyphs:

| Decoration | Source | Meaning |
| --- | --- | --- |
| 3px left accent | `resolveWorkspaceColor(ws.color, ws.name)` | The task's workspace colour. |
| Row glyph | workspace emoji icon, else `ORIGIN_GLYPH` | Workspace emoji if set, else origin glyph: `github-pr ⌥`, `linear ◷`, `rollbar ◍`, `local ●`. |
| Checks dot | warmed PR detail (`checksState`) | PR CI state; shown only when the task has a PR and checks exist. |
| Spinner `⠿` | `workingCountFor(taskId)` | One or more agents currently working (desktop-only — needs the terminal bridge). |
| Needs-you `‼` | `unreadForTask(taskId)` | Unread agent notifications; cleared when the task is viewed. |
| Dirty `✎` / repair `⚠` | `taskStatus(taskId)` | Uncommitted changes (with count), or worktree missing (removed outside acorn → needs repair). |
| Pin `⌖` | `rail_order` | Pinned-to-top marker. |

### Ordering: `rail_order`, not `tasks.sort`

Pin-to-top and drag-reorder are **view state**, persisted in a dedicated `rail_order` pref — never
`tasks.sort` (the source note: sort once derived dev-server ports; even though ports moved off sort,
reordering stays out of it on principle). The pure, unit-tested model is
`apps/desktop/src/core/client/tabs/railOrder.ts`:

```
RailOrder = { pinned: string[]; order: string[] }
```

`applyRailOrder` partitions the workspace-scoped list into pinned (their saved order) → manual order →
everything else in `tasks.sort` order. `pinTask`/`unpinTask`/`moveTask` are pure transforms; the rail
serializes the result back to the pref and invalidates. Cross-partition drags adopt the target partition
(dragging a row above a pinned row pins it).

### Interaction

- **Click** a row → make it active and navigate to its repo/PR (`pathForTask`,
  `apps/desktop/src/core/client/tasks/activate.ts:6`). Activation restores the task's last-used
  pane, or picks a default (`pr`, else `linear` if a Linear link exists) the first time.
- **Click the active row** → open a popover with **Pin/Unpin**, **Rename**, **Archive**.
- **⌘1–9 / Ctrl+1–9** → jump to the Nth *visible* task (exactly what's rendered — workspace-scoped +
  rail order). Safe to leave active while typing since it requires meta/ctrl (`TabRail.tsx:103`).
- **`+`** → New local-first task (modal described above); errors if the active workspace has no repos.

### Per-task worktree status polling

`taskStatus.ts` (`apps/desktop/src/core/client/tasks/taskStatus.ts`) holds a signal of
`TaskStatus` per task (`dirty`, `dirtyCount`, `missing`), refreshed from the terminal bridge on a 5s
interval plus on `onStatus` edges. It is a no-op on the web build (no terminal bridge). The 5s poll is a
deliberate `ponytail` simplification — cheap over a handful of worktrees; tighten to a watcher only if it
ever matters.

---

## Sources & browse

A Source browse view lists a provider's items and **promotes** one to a Task.

- **LinearBrowse** (`apps/desktop/src/plugins/linear/client/LinearBrowse.tsx`) — Linear projects are
  linked at the **workspace** level (see `workspace_projects`) and may span several connected Linear
  workspaces. The pane shows issues across the active workspace's linked projects, with a "Projects"
  picker that reads/writes those links. Clicking an issue promotes it to a `linear`-origin task on the
  *current repo*, tagged with the ticket + its owning integration, and switches to the `linear` pane.
- **RollbarBrowse** (`apps/desktop/src/plugins/rollbar/client/RollbarBrowse.tsx`) — recent error items
  across connected projects. An error has no inherent repo/branch, so "open as task" prompts for both
  (branch defaults to a slug of the title). Alternatively "＋task" attaches the error to the currently
  active task as a new `task_link` (its most common flow).

See [`integrations.md`](./integrations.md) for the provider connections themselves.

---

## Data model & API summary

Tables (full detail in [`data-layer.md`](./data-layer.md), schema at
`apps/desktop/src/core/server/db/schema.ts`):

| Table | Role |
| --- | --- |
| `workspaces` | The group: identity, scripts, preview config. |
| `workspace_repos` | Repo → workspace membership (partition). PK `(repoOwner, repoName)`. |
| `ignored_repos` | Repos hidden from the main UI. PK `(owner, repo)`. |
| `workspace_projects` | External-project links per workspace. PK `(workspaceId, integrationId, externalId)`. |
| `tasks` | The unit of work. |
| `task_links` | External items a task references. PK `(taskId, integrationId, identifier)`. |

Naming wart, accepted: `workspace_repos` keys on `(repoOwner, repoName)` while `ignored_repos` and
`repo_paths` key on `(owner, repo)` — remember which spelling a table uses when joining. Aligning
them isn't worth a table-rebuild migration on its own; do it next time these tables are rebuilt.

Endpoints (full detail in [`api-reference.md`](./api-reference.md); all auth-gated, machine-scoped):

| Method + path | Purpose |
| --- | --- |
| `GET /api/workspaces` | List workspaces (each with its non-ignored repos). |
| `POST /api/workspaces/bootstrap` | Idempotent first-run: ensure Default + assign unmapped repos. |
| `POST /api/workspaces` | Create a workspace. |
| `PATCH /api/workspaces/:id` | Update name / scripts / trigger / preview / icon / colour. |
| `DELETE /api/workspaces/:id` | Delete (reassigns repos to Default; not allowed for Default). |
| `POST /api/workspaces/:id/repos` | Assign a repo to this workspace (un-ignores it). |
| `GET /api/workspaces/assignments` | Per-repo `{ workspaceId, ignored }` map for onboarding. |
| `POST /api/workspaces/ignore-repo` · `/unignore-repo` · `/ignore-all` | Hide / show repos. |
| `GET`/`PUT /api/workspaces/:id/projects` | Read / replace external-project links. |
| `GET /api/tasks` | List active tasks (ordered by `sort`, with links). |
| `POST /api/tasks` | Create a task from a seed. |
| `PATCH /api/tasks/:id` | Rename / archive (status flip). |
| `POST`/`DELETE /api/tasks/:id/links` | Grow / shrink external links. |

---

## Lifecycle note

Terminal-driven lifecycle is desktop-only (it needs the main-process worktree capability —
`capabilities()`, always on when present; the old `acorn:term` flag is gone). The CRUD above works
without it.

- **Worktree creation is lazy** (Flow C): `tasks.worktreePath` stays null until a terminal is first
  opened for the task, at which point the main process creates the git worktree and (per the workspace's
  `setupScriptTrigger`) may run the `setupScript`.
- **Archive** runs through the guarded main-process teardown when on desktop: it refuses while sessions
  are running or the worktree is dirty, runs the workspace `teardownScript` in the worktree, then removes
  the worktree (`terminalApi().task.archive`; main decides "no worktree → plain flip"). The rail's
  confirm/error dialog is the same modal shell as create/rename (no `window.confirm`/`alert`), and the
  plain HTTP status flip exists only for the bridge-absent browser dev build. Archiving also evicts the
  task's kept-alive preview `WebContentsView`.
- **Archive keeps the row.** `status` flips to `archived` and `archivedAt` is stamped; the row survives
  for history and teardown audit. Only `active` tasks appear in the rail.

---

## Source

Client shell: `apps/desktop/src/core/client/{tabs,tasks,workspaces}/`; provider browse views and
onboarding live under `apps/desktop/src/plugins/{linear,rollbar,onboarding}/client/`.
Server: `apps/desktop/src/core/server/routes/{workspaces.ts,tasks.ts}`, PR inheritance in
`apps/desktop/src/plugins/github/server/routes/pulls.ts:142`.
Shared: `apps/desktop/src/core/shared/{workspaceIdentity.ts,branch.ts}`. Schema:
`apps/desktop/src/core/server/db/schema.ts`.

**See also:** [`panes.md`](./panes.md) (the Task view surfaces) ·
[`terminal-and-agents.md`](./terminal-and-agents.md) (worktrees, sessions, run targets) ·
[`integrations.md`](./integrations.md) (Linear/Rollbar connections) ·
[`data-layer.md`](./data-layer.md) · [`api-reference.md`](./api-reference.md).
