# 05 — Lifecycle & isolation (the two hard problems)

Every product in the research flags the same two unsolved-or-hard problems for the task/worktree
model: **lifecycle** (who owns a worktree, and when is it cleaned up?) and **isolation** (worktrees
isolate files, not runtime). This doc states acorn's position on both.

## Problem 1 — worktree lifecycle

cmux's own notes are the warning: "nothing cleans the worktree on close, nothing snapshots on crash,
nothing tracks which pane owns which worktree." Making the Workspace own `worktreePath`
([`03`](./03-data-model.md)) is what lets us answer each of these.

### Create / reuse
Lazy, on first terminal in a workspace (Flow C in [`02`](./02-ui-design.md)):

```
open terminal in workspace W
  W.worktreePath set? ── yes ──▶ cwd = W.worktreePath  (reuse)
  no ──▶ git worktree add <path> <branch>   ← existing api.worktree.ensure() (vNext §9)
         path = .acorn/worktrees/<owner>-<repo>-<branch-slug>
         persist W.worktreePath; cwd the session there
```

The base checkout the worktree is added from comes from `repo_paths` (`schema.ts:247`). If the repo
has no mapped path, the terminal flow already prompts for one (today's `repoPath.set()` in
`TerminalPanel.tsx`) — unchanged.

Path keying changes from PR-number to **branch** (`<owner>-<repo>-<branch-slug>`), because a
workspace is branch-first (local-first workspaces have no PR number). Existing PR worktrees keep
working; the key is just derived from `headRef` instead of `pr-<n>`.

### Dirty detection
A workspace row shows a dirty marker (`✎` in the rail) when its worktree has uncommitted changes.
This is `git status --porcelain` against `worktreePath`, run by the main-process terminal service
(it already does dirty-state detection in vNext Phase 4) and surfaced on the session/workspace
status the renderer subscribes to. No new transport — it rides the existing `onStatus` channel.

### Archive / teardown
Archiving a workspace (`status: 'archived'`, `archivedAt` set) is the **only** thing allowed to
remove a worktree, and it must be explicit and guarded:

```
archive workspace W
  any terminal session still running in W?  ── yes ──▶ refuse / prompt to stop them first
  W.worktreePath dirty?                     ── yes ──▶ refuse with the dirty file list
                                                       (never silently discard work)
  else ──▶ git worktree remove <path>; clear W.worktreePath; mark archived
```

We keep the archived row (we don't delete it) for history and so a teardown that half-failed can be
retried. This is the discipline the research says is missing everywhere: **destruction is gated on
"no running sessions" + "not dirty," and is never automatic.**

### Crash / restart recovery
The hooks already exist in vNext:
- tmux-backed sessions survive an app restart; on startup the terminal service reconciles
  `terminal_sessions` rows against `tmux list-sessions` (`schema.ts:260` comment).
- With `workspaceId` on the session, a recovered session re-associates to its workspace
  automatically — the rail rebuilds from the `workspaces` table, sessions re-attach by id.
- Worktrees are just directories on disk; they survive trivially. On startup we reconcile
  `workspaces.worktreePath` against `git worktree list` and flag any that vanished (manual `rm`
  outside acorn) as needing repair rather than crashing.

We do **not** attempt content snapshots on crash (the cmux wishlist item). tmux + on-disk worktree +
the durable rows are enough for a single-user local app; snapshotting is a later rung if ever.

## Problem 2 — runtime isolation

The hard ceiling every writeup names: worktrees isolate the **filesystem**, not the **runtime**.
Two workspaces running dev servers will collide on ports, databases, caches, env, and test state.

### Near-term scope: per-workspace dev command + port
This is the "custom commands you might want to run depending on the repository" the user mentioned,
and it's the cheapest useful slice of runtime isolation:

- A repo gets a configured **run command** (e.g. `pnpm dev`) and a **port variable**. Store it
  alongside `repo_paths` (a `run_command` / `dev_port_base` column, or a `prefs`-style per-repo
  config) — design detail deferred, but it's repo-scoped config, not a new subsystem.
- The **dev-server pane** runs that command in the workspace's worktree, injecting a
  **per-workspace port** (e.g. base + a small offset derived from the workspace's rail index) so two
  workspaces' dev servers don't fight over `:3000`.
- The **browser-preview pane** points a `<webview>` at `http://localhost:<that-port>`.

This covers the 80% case (a frontend dev server per workspace) without containers.

### Explicitly deferred: containers / full runtime isolation
Databases, shared caches, secrets, and test state still collide — the same gap cmux escalates to
devcontainers for. acorn does **not** solve this now. The honest scope statement, matching the
research consensus:

> Worktrees + a per-workspace dev port give the best cost-to-isolation ratio for **code-only and
> single-dev-server** tasks. Workspaces that need isolated databases/services are out of near-term
> scope; the upgrade path is per-workspace containers/devcontainers, layered on later without
> changing the Workspace entity.

`// ponytail:` we ship file isolation + a dev port, and name the container ceiling rather than
building for it speculatively.

## Summary of guarantees
| Concern | Near-term answer |
| --- | --- |
| Who owns a worktree? | Exactly one workspace, via `workspaces.worktreePath` |
| When is it removed? | Only on explicit archive, gated on no-running-sessions + not-dirty |
| Survives app restart? | Yes — tmux sessions + durable rows + on-disk worktree, reconciled on startup |
| Survives crash? | Yes (no content snapshot, by choice) |
| File collisions between workspaces? | Solved (separate worktrees) |
| Port collisions (dev servers)? | Solved (per-workspace port) |
| DB / cache / secret / test-state collisions? | **Not solved** — deferred to containers |
