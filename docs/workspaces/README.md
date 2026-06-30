# Workspaces — unifying PRs, terminals, worktrees & integrations

> ## ⚠️ Two-tier update (current model)
> These docs were written when **"Workspace" meant a single unit of work** (one repo + branch + PR +
> worktree + terminals). That entity has since been **renamed `Task`**, and **"Workspace" now means a
> named *group of many repos*** — the top-level thing you pick in the top bar.
>
> | Concept | These docs call it | Current name |
> | --- | --- | --- |
> | One repo + branch + PR + worktree + terminals (a rail row) | "Workspace" | **Task** |
> | A named group of repos (top selector) | — (didn't exist) | **Workspace** |
>
> Rules of the current model:
> - A repo belongs to **exactly one** Workspace (partition). The active Workspace is *derived* from
>   the current repo — no URL/routing dimension.
> - On first login a **Default** Workspace is auto-created and every repo is assigned to it (an
>   idempotent `bootstrap` endpoint); a first-run onboarding modal lets you re-group repos, create
>   workspaces inline, (on desktop) point each repo at its on-disk folder via a native picker, and
>   **hide repos** with a per-row eye toggle (plus a master toggle to hide/show all). On-disk paths
>   live in `repo_paths` (unchanged); hidden repos keep their membership but sit in `ignored_repos`.
> - The active Workspace shows in the top selector; the repo sub-selector is **disabled inside a
>   task view** (the worktree's repo is fixed) but live while browsing a Source.
> - Linear projects link at the **Workspace** level, so one project spans many repos.
> - Tables: `workspaces` (group), `workspace_repos` (partition, PK `(owner,repo)`),
>   `workspace_linear_projects`; the old `workspaces`/`workspace_links` became `tasks`/`task_links`;
>   `terminal_sessions.workspace_id` → `task_id`.
>
> Below this line, **read "Workspace" as "Task"** unless it clearly refers to the new group.

> Status: **design / proposal**. These docs survey the
> options, commit to a direction, and specify the UI, data model, and a phased build. The build
> starts from a **clean schema baseline** (Phase 0): there's no production data worth keeping, so we
> wipe the local SQLite DB and collapse the migrations into one fresh baseline rather than threading
> incremental migrations through live data. The **existing UI is reused as-is** — only the
> path-bookmark *tab* concept is dropped in favour of real entities.

## The problem

Acorn has grown three navigation systems that **don't share state**:

1. **Workspace tabs** (`apps/web/src/client/features/tabs/`) — generic `{ id, icon, path }`
   bookmarks of a router path, persisted to `prefs` under the `workspace:tabs` key
   (`features/tabs/model.ts:2`). They remember *where you were* per repo. Nothing more.
2. **Router params** (the URL) — the real source of truth for *what is displayed*: the PR list,
   detail, and diff (`PullList` / `PullDetail` / `DiffView`).
3. **Terminal sessions** (`features/terminal/sessions.ts`) — one global store, made visible by
   filtering on the **current router params** (`TerminalPanel.tsx:36`), **not** the active tab.

So the three axes drift apart. The tab rail tracks *memory*; the panes track *the URL*; the terminal
tracks *the URL too, but only for visibility*. Linear is account-level and surfaced only inline
inside PR detail. Worktrees exist (vNext Phase 4) but aren't real entities — they're inline
`.acorn/worktrees/<owner>-<repo>-pr-<n>` paths flagged by a transient `isWorktree` boolean on a
session (`shared/terminal.ts:12`).

**Nothing in the system owns the bundle a person actually works in:** _a repo + a branch + a local
worktree + a PR + a Linear/Rollbar ticket + the terminals and dev servers running against it._

```
                        TODAY: three axes, no shared owner

  ┌──────────────┐      ┌──────────────────────────┐      ┌────────────────────┐
  │  Tab rail    │      │  Router (the URL)         │      │  Terminal store    │
  │  {id,icon,   │      │  /owner/repo/123          │      │  (global)          │
  │   path}      │      │  → PullList/Detail/Diff   │      │  filtered by URL   │
  │  = memory    │      │  = what's on screen       │      │  = what's running  │
  └──────────────┘      └──────────────────────────┘      └────────────────────┘
        │                          │                                │
        └──── remembers a path ────┘                                │
                                   └──── visibility coupling only ───┘
                            (no entity links PR ↔ worktree ↔ terminal ↔ ticket)
```

## The direction

Introduce a first-class **Workspace**: the unit of work that *owns* the bundle. It has an origin
(GitHub PR / Linear / Rollbar / local), a repo + branch, an optional worktree, an optional linked
PR, zero-or-more linked external issues, and a set of **panes** (PR review, Linear, terminal/agent,
dev server, browser preview).

```
                          PROPOSED: the Workspace owns the bundle

  ┌─ Left rail ──────────┐   ┌─ Workspace view ─────────────────────────────┐
  │ SOURCES              │   │  acme/api · PR #123 · feat/login              │
  │   ◇ GitHub           │   │  ┌────────────────────────────┐  ┌─ panes ─┐ │
  │   ◇ Linear           │   │  │                            │  │  ⌥ PR   │ │
  │   ◇ Rollbar          │   │  │   active pane              │  │  ◷ Lin  │ │
  │ ──────────────────   │   │  │   (PR review / terminal /  │  │  > Term │ │
  │ WORKSPACES           │   │  │    Linear / dev / preview) │  │  ▶ Dev  │ │
  │   ● #123 login  ⠿    │   │  │                            │  │  ◍ Prev │ │
  │   ● fix-cache   ✎    │   │  └────────────────────────────┘  └─────────┘ │
  │   ● ENG-42          │   │  worktree: .acorn/worktrees/…  ● dirty         │
  └──────────────────────┘   └───────────────────────────────────────────────┘
```

This is **Conductor's task-as-unit model, generalized** so a Workspace can originate from any
source — not just a new branch, but an existing PR, a Linear ticket, a Rollbar error, or plain
local code that gets a PR attached later. See [`01-organizing-models.md`](./01-organizing-models.md)
for why this beats the alternatives.

## Read in this order

| Doc | What it covers |
| --- | --- |
| [`01-organizing-models.md`](./01-organizing-models.md) | The four organizing models, competitive research, and why we pick the Workspace model |
| [`02-ui-design.md`](./02-ui-design.md) | The two-zone rail, the workspace view, the pane switcher, the promotion & local-first flows |
| [`03-data-model.md`](./03-data-model.md) | The `Workspace` entity, the new tables, and what replaces today's `Tab` / `workspace:tabs` |
| [`04-sources-and-integrations.md`](./04-sources-and-integrations.md) | Sources as entry points; the uniform "Source item → Workspace" contract; Linear & Rollbar |
| [`05-lifecycle-and-isolation.md`](./05-lifecycle-and-isolation.md) | Worktree lifecycle (create/reuse/teardown/recovery) and runtime isolation (ports/DB/env) |
| [`06-implementation-phases.md`](./06-implementation-phases.md) | The clean-slate schema reset (P0) and the phased build of the Workspace model on top of today's UI |

## Relationship to existing docs

This builds directly on [`../vNext.md`](../vNext.md) (terminal/agent sessions, Phase 4 worktrees)
and the data layer in [`../data-layer.md`](../data-layer.md). It does **not** replace them — it adds
the owning entity that the vNext work left implicit.
