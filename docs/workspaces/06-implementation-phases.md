# 06 — Implementation phases

> ## ✅ Status: all phases (P0–P5) shipped
> Every phase below has landed, with the renames from the two-tier table in
> [`README.md`](./README.md): the entity built here is the **`tasks`** table / `Task` type, and
> `terminal_sessions` got **`task_id`**, not `workspace_id`. The phase bodies below are a short
> **"how it was built" record** — the step-by-step procedure text (schema resets, ABI dances,
> acceptance criteria) was one-time work and has been collapsed; `schema.ts` and
> [`03-data-model.md`](./03-data-model.md) are the source of truth for the shipped shapes.
> Follow-on work (multi-pane layout, editor/browser/notes/context panes, run targets, MCP, memory,
> workflows) is specified in [`../next/`](../next/README.md), not here.

The original plan: a path from the three-axis system to the Workspace model, in the incremental
style of [`../vNext.md`](../vNext.md), each phase independently shippable. The ordering
front-loaded a **clean schema baseline** (P0) and the **entity + drift fix** (the highest-value
wins) and deferred the bigger UI surgery. There was **no production data worth preserving** (the
GitHub mirror re-syncs on launch), so P0 skipped incremental schema surgery entirely and landed the
whole schema as one fresh baseline — every later phase built against a clean schema, with no
backward-compat, no nullable hedges, and no migration of old state.

---

## P0 — Reset the schema baseline ✅ done

**Goal:** one fresh migration that already contains the Workspace tables; no legacy data to tend.

**How it went:** the reset happened — `apps/desktop/migrations/0000_useful_magik.sql` is the fresh
baseline and already contains `tasks`, `task_links`, `workspaces`, `workspace_repos`, and
`terminal_sessions` with a `NOT NULL task_id` (the loose `repo_owner`/`repo_name`/`pull_number`
columns were never created — exactly as designed, so the Drizzle `NOT NULL` table-rebuild quirk
never bit). Since then the baseline has accrued incremental migrations (`ignored_repos`, workspace
scripts/preview/icon/color, the `workspace_projects`/`integrations`/`issues`/`task_links` re-key
onto `integrationId`, `review_notes`, `memories` + FTS5, `workflow_runs`/`workflow_steps`,
`tasks.parent_id`, run targets, editor command, …). That's normal post-baseline evolution, not
drift — the "single `0000` baseline" state is historical.

## P1 — The owning entity + rail backed by it ✅ done (as `tasks`)

**Goal:** a real owning entity exists; the rail reads from it.

**How it went:** the entity shipped as **`tasks`** (`apps/desktop/src/server/routes/tasks.ts`:
create / list-active / rename / archive), and a *second* router shipped for the new group-level
`workspaces` (`routes/workspaces.ts`, including the idempotent `bootstrap`). `TabRail.tsx` renders
Task rows from `tasksOptions` — with more than planned: pin/drag ordering
(`features/tabs/railOrder.ts`, a client pref, not a route), per-task unread notification badges,
worktree dirty markers (`taskStatus.ts`), workspace colors, and ⌘1–9 activation. The path-bookmark
`Tab` mechanism was never built, as designed.

## P2 — Bind terminals to the entity (kill the drift) ✅ done (as `taskId`)

**Goal:** the disconnect from [`README.md`](./README.md) is gone.

**How it went:** `TerminalSession.taskId` / `CreateOpts.taskId` are in
`apps/desktop/src/shared/terminal.ts`, and `TerminalPanel.tsx` filters
`sessions().filter(s => s.taskId === task.id)` (the `visibleSessions` memo) — the URL coupling is
gone; a terminal opened in task A never shows under task B. The main process derives the wire
type's `repo` / `pull` from the task join, as designed. The column landed in P0, so this phase was
wiring only.

## P3 — Promotion flow + persisted worktree lifecycle ✅ done

**Goal:** Source items become tasks; worktrees are owned and torn down cleanly.

**How it went:** all of it landed. "Open as task" on PR rows seeds Linear links from the PR body at
promotion time (`PullList.tsx` `scanLinearRefs` — only when exactly one Linear connection exists,
since `task_links` now needs an `integrationId`); local-first "New task"; lazy branch-keyed
worktrees (`main/terminal.ts` → `main/worktrees.ts`); PR inheritance (Flow B) runs in
`routes/pulls.ts` on mirror sync. Archive went **beyond** the design: `ArchiveOpts` supports
`deleteWorktree` / `force` / `skipTeardown`, and a per-workspace **teardown script** (docs/terminal-and-agents.md)
runs before removal, with `teardownFailed` surfaced to the UI — the guarded flow is drawn in
[`05`](./05-lifecycle-and-isolation.md).

## P4 — Pane switcher + PR review as a pane + Sources split out ✅ done (extended)

**Goal:** the cohesive single-window view.

**How it went:** `TaskView.tsx` + the pane reducer (`features/tasks/layout.ts`) shipped, then grew
past this spec: the layout is a **multi-pane row** (⌘-click opens a pane beside the others,
docs/panes.md), and the pane set is `pr | linear | rollbar | preview | editor | changes | notes |
context`. Terminal is **not** a pane — it stayed a bottom drawer (deliberate; see
[`02`](./02-ui-design.md)'s shipped notes). The Sources zone shipped with integration gating
(`availableSources()` in `features/tabs/sources.ts`), plus `LinearBrowse.tsx` / `RollbarBrowse.tsx`
browse views; `PullList` became the GitHub Source browse view.

## P5 — Dev-server support + Rollbar + browser preview ✅ done (divergent)

**Goal:** local-run support and the remaining integrations.

**How it went:** all three landed, but the dev-server design diverged: there is **no per-task port
allocation**. Dev servers shipped as **run targets** (docs/next 13 §A) — named commands from a
committed `.acorn/config.toml` or the `repo_paths.run_targets` JSON fallback (the interim
`run_command`/`dev_port` columns that predated run targets have been removed) — running as
ordinary terminal sessions in the drawer; "acorn allocates no ports". The preview `<webview>`
shipped (`webviewTag: true`, guest pinned to localhost in `main/electron.ts`) and resolves its URL
via `workspaces.preview_mode` (`url | port | script`) or a run target's `url`/`url_command` —
richer than the design's "base + rail offset" scheme, which was never built
([`05`](./05-lifecycle-and-isolation.md) has the honest trade-off). Rollbar shipped exactly as the
litmus test hoped: `routes/rollbar.ts` caches into the generic `issues` table with zero new schema.

---

## Sequencing rationale (design-time, kept for the record)
- **P0 was a one-time reset**: collapsing the migrations and landing the full schema once was far
  cheaper than threading `task_id` through a populated table with incremental ALTERs — and there
  was no data to lose.
- **P1+P2 were the cheap, high-value core**: they fixed the actual disconnect and created the
  entity, with almost no UI surgery.
- **P3 was the behavioural heart** (promotion + owned worktrees) — the part that needed the most
  care (the lifecycle guards in [`05`](./05-lifecycle-and-isolation.md)).
- **P4 was presentation** — reorganizing components that already existed into panes.
- **P5 was additive** — new panes/sources that didn't change the core model.

## Out of scope (named, not built)
Container/devcontainer runtime isolation; crash-time content snapshots; cross-source dedup;
bi-directional integration sync. See the deferred sections of [`04`](./04-sources-and-integrations.md)
and [`05`](./05-lifecycle-and-isolation.md). These remain unbuilt as of the shipped-status pass;
some now have designs in [`../next/`](../next/README.md).

