# 02 — UI design (conceptual UX)

This describes the interaction model. Layout/theming conventions defer to
[`../ui-design.md`](../ui-design.md); this doc is about *structure and flow*, not pixels.

## The two-zone left rail

The leftmost rail splits into two zones. The split is the whole point: it separates **where you
discover work** from **what you're working on**.

```
┌─ Left rail ────────┐
│ SOURCES            │   ← entry points / browse views. Fixed set, driven by
│   ◇ GitHub         │     connected integrations. Selecting one fills the main
│   ◇ Linear         │     area with that source's browse UI (e.g. the PR list).
│   ◇ Rollbar        │     A source is NOT a workspace.
│ ─────────────────  │
│ WORKSPACES         │   ← your in-flight things. Each row is a Workspace that
│   ● #123 login  ⠿  │     owns a worktree + panes. Rows show live status:
│   ● fix-cache   ✎  │       ⠿ agent working   ✎ dirty worktree   ✓/✗ PR checks
│   ● ENG-42         │     Selecting one opens the Workspace view (below).
│   ＋ New workspace  │
└────────────────────┘
```

**Sources (top)** are the browse surfaces. GitHub's source view is essentially today's `PullList`
across repos. Linear's is a ticket list; Rollbar's is an error list. They are stateless entry
points — you look, then **promote** something into a Workspace.

**Workspaces (below)** are the Conductor-style roster. This is what today's `TabRail`
(`features/tabs/TabRail.tsx`) becomes — but instead of generic `{id, icon, path}` bookmarks, each
row is backed by a real Workspace entity (see [`03-data-model.md`](./03-data-model.md)). The
agent-working indicator that `TabRail` already computes via `workingCountFor()` stays — it just
keys off the workspace's sessions instead of a path.

## The Workspace view (panes + switcher)

Selecting a Workspace replaces the browse area with that workspace's view: a single active pane plus
a **pane switcher** (the small view icons the user already has, now given a job).

```
┌─ Workspace: acme/api · PR #123 · feat/login ──────────────────────────┐
│ ┌─────────────────────────────────────────────┐  ┌─ panes ─────────┐  │
│ │                                               │  │ ⌥  PR review    │  │  ← only panes that
│ │              active pane                      │  │ ◷  Linear ENG-9 │  │    apply to THIS
│ │   (one of: PR review / Linear / terminal /    │  │ >_ claude       │  │    workspace show.
│ │    dev server / browser preview)              │  │ ▶  dev server   │  │    No PR yet? no
│ │                                               │  │ ◍  preview      │  │    PR pane.
│ └─────────────────────────────────────────────┘  └─────────────────┘  │
│ worktree: .acorn/worktrees/acme-api-pr-123   ● dirty (3 files)         │
└────────────────────────────────────────────────────────────────────────┘
```

Pane types:
- **PR review** — today's `PullDetail` + `DiffView`, scoped to this workspace's PR. (The cross-PR
  `PullList` does *not* live here — it stays in the GitHub Source view.)
- **Linear** — today's `LinearIssuePanel`, promoted from an inline portal to a first-class pane,
  showing the workspace's linked issue(s).
- **Terminal / agent** — today's `TerminalPanel` sessions, but scoped to the workspace (not the
  URL). Claude Code, a shell, etc.
- **Dev server** — a terminal pane running the repo's configured run command (the "custom commands
  per repository" the user mentioned). See [`05-lifecycle-and-isolation.md`](./05-lifecycle-and-isolation.md).
- **Browser preview** — a `<webview>` onto the dev server's local URL. Seam only for now (Phase 5).

The switcher is per-workspace: switching workspaces swaps the *whole* set of panes, so two
workspaces looking at different PRs never share a terminal again — the drift described in
[`README.md`](./README.md) is gone.

## Flow A — promotion (browse → workspace)

The common path. You're in a Source view; you turn an item into a workspace.

```
GitHub source (PR list)            Linear source (ticket list)       Rollbar source (errors)
        │                                   │                                 │
   click PR #123                       click ENG-42                      click error #88
        │                                   │                                 │
        └──────────────┬────────────────────┴─────────────────────────────────┘
                       ▼
              "Open as workspace"
                       │
        creates a Workspace row in the rail with:
          • origin = github-pr | linear | rollbar
          • repo + branch inferred from the source item
          • the source item attached as a link / the PR pane
        (no worktree yet — created lazily on first terminal, Flow C)
```

The GitHub source's PR rows get an "Open as workspace" affordance alongside today's
navigate-to-detail click. Promoting a Linear ticket infers the repo from the ticket's linked
branch/PR when present, else prompts for a repo + new branch name.

## Flow B — local-first (then inherit a PR)

The reverse path the user called out: "you might be working on something locally that you've made a
pull request for, so there's no review… as soon as a pull request gets opened it'll inherit the PR
view."

```
"New workspace" → pick repo + new branch (origin = local)
        │
   worktree created, terminal pane ready, NO PR pane
        │
   …you work, push, open a PR for the branch…
        │
   acorn detects a PR whose headRef == workspace.branch
        │
   PR pane appears automatically; workspace.pullNumber is set
```

Detection reuses the existing PR mirror: a Workspace with a `branch` and no `pullNumber` is matched
against `pull_requests.headRef` for its repo on the next sync. This is the inheritance the user
wants, falling out of data we already store.

## Flow C — lazy worktree on first terminal

A Workspace doesn't create a worktree until you open a terminal in it. This keeps "I just want to
read the PR" cheap and matches Conductor (the worktree is created with the workspace, but acorn
defers it to the first terminal to avoid touching disk for review-only workspaces).

```
open terminal pane in a workspace
        │
   workspace has a worktreePath?  ── yes ──▶ reuse it (cwd = worktreePath)
        │ no
   ensure worktree for (repo, branch)         ← existing api.worktree.ensure() (vNext §9)
        │
   persist worktreePath on the workspace; cwd the session there
```

## Component remapping (today → proposed)

| Today | Becomes |
| --- | --- |
| `features/tabs/TabRail.tsx` (generic path tabs) | The **Workspaces** zone of the rail (rows backed by Workspace entities) |
| `features/tabs/model.ts` `Tab` / `workspace:tabs` pref | Not built — the rail renders `workspaces` rows directly (see [`03`](./03-data-model.md)) |
| `PullList` | The **GitHub Source** view (cross-PR browse) — keeps its home, no longer "the app" |
| `PullDetail` + `DiffView` | The **PR review pane** inside a workspace |
| `LinearIssuePanel` (inline portal) | The **Linear pane** inside a workspace |
| `TerminalPanel` (URL-filtered global store) | **Terminal/dev panes** scoped to `workspaceId` |
| `IntegrationsModal` | Unchanged — still where you connect Linear/Rollbar; now also gates which Sources appear |

## Open UI questions (deferred to implementation)
- Does the PR review pane keep its three-column layout inside the workspace, or collapse the list
  column (since the list now lives in the Source view)? Leaning collapse.
- Multiple terminals per workspace: tabs within the terminal pane, or multiple terminal panes? The
  pane switcher can hold N terminals; defer the exact affordance.
- Keyboard model: today's `j/k` PR-list nav and shortcuts need a workspace-switch binding
  (e.g. `⌘1..9` to the rail). Defer to the shortcuts pass.
