# 05 — Lifecycle & isolation (the two hard problems)

> **✅ Status: lifecycle shipped as designed (and then some); isolation shipped *differently*.**
> Read "workspace" as **Task** (README two-tier note). Lifecycle: lazy branch-keyed worktrees,
> dirty detection (`TaskStatus` polled by the rail/footer), guarded archive, and startup
> reconciliation all landed in `apps/desktop/src/main/{terminal,worktrees}.ts` — plus things this
> doc didn't specify: a per-workspace **setup script** run on worktree creation
> (`workspaces.setup_script` / `setup_script_trigger`), a **teardown script** run before removal
> with `teardownFailed` surfaced to the UI, `ArchiveOpts` (`deleteWorktree` / `force` /
> `skipTeardown`), and a `missing` flag when a worktree vanished outside acorn (needs-repair, not
> crash). Isolation: the "per-workspace port" scheme below was **not built** — dev servers shipped
> as **run targets** (docs/next 13 §A) with URL resolution instead of port allocation; see the
> annotated section below.

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

The base checkout the worktree is added from comes from `repo_paths` (`repoPaths` in `schema.ts`). If the repo
has no mapped path, the terminal flow already prompts for one (today's `repoPath.set()` in
`TerminalPanel.tsx`) — unchanged.

Path keying changes from PR-number to **branch** (`<owner>-<repo>-<branch-slug>`), because a
workspace is branch-first (local-first workspaces have no PR number). Existing PR worktrees keep
working; the key is just derived from `headRef` instead of `pr-<n>`.

### Dirty detection
A workspace row shows a dirty marker (`✎` in the rail) when its worktree has uncommitted changes.
This is `git status --porcelain` against `worktreePath`, run in the main process
(`computeTaskStatuses` in `main/terminal.ts`). The design said it would "ride the existing
`onStatus` channel"; **as shipped the transport is a push-vs-poll split**: `onStatus`
(`term:status`) pushes session idle/exit pings, but worktree dirty/missing state is **polled** by
the renderer via `terminal.task.statuses()` (the `term:task:statuses` invoke in `main/preload.ts`)
— a 5s interval plus a refresh on each `onStatus` edge (`features/tasks/taskStatus.ts`), since git
file changes don't ping `onStatus`.

### Archive / teardown
Archiving a workspace (`status: 'archived'`, `archivedAt` set) is the **only** thing allowed to
remove a worktree, and it must be explicit and guarded. The shipped flow (`archiveTask` in
`main/archive.ts`; `ArchiveOpts` / `ArchiveResult` in `shared/terminal.ts`) grew a teardown-script
step and override branches beyond the original sketch — that richer lifecycle shipped and is what
the flow below shows (see also [`../terminal-and-agents.md`](../terminal-and-agents.md)):

```
archive task T   opts: { deleteWorktree = true, force = false, skipTeardown = false }
  sessions still running in T? ──(and !force)──▶ refuse: "Stop N running sessions first"
        │
  deleteWorktree && !skipTeardown && worktree exists?
        │ yes: workspace teardownScript configured?
        │        └─ yes ──▶ run it IN the still-existing worktree (2-min timeout,
        │                   streamed to the drawer)
        │                     exit ≠ 0 ──▶ pause: { ok:false, teardownFailed, output }
        │                                 — caller re-archives with skipTeardown, or aborts;
        │                                 nothing has been torn down yet
        ▼
  force? ──▶ kill T's running sessions
  deleteWorktree? ──▶ git worktree remove <path>
        (a dirty tree refuses with the reason unless force, which discards it —
         never silently)
  drop T's terminal_sessions rows
  mark archived: status='archived', archivedAt set, worktreePath cleared
```

We keep the archived row (we don't delete it) for history and so a teardown that half-failed can be
retried. This is the discipline the research says is missing everywhere: **destruction is gated on
"no running sessions" + "not dirty," and is never automatic** — the shipped `force` /
`deleteWorktree: false` overrides are explicit user choices, not defaults.

### Crash / restart recovery
The hooks already exist in vNext:
- tmux-backed sessions survive an app restart; on startup the terminal service reconciles
  `terminal_sessions` rows against `tmux list-sessions` (see the `terminalSessions` comment in
  `schema.ts`).
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

> **Shipped divergence — run targets, not port allocation.** What landed (docs/next 13 §A):
> named **run targets** per repo (a committed `.acorn/config.toml`, falling back to
> `repo_paths.run_targets` JSON; the interim `run_command`/`dev_port` columns that predated run
> targets have been removed), each running as an ordinary terminal session in the drawer. **acorn allocates no
> ports** — the port-offset scheme above was judged too magical (frameworks pick their own ports,
> env vars differ). Instead a target declares its URL (`url` / `url_command`), and the preview
> `<webview>` resolves through that or the workspace-level `preview_mode` (`url | port | script`).
> Consequence to be honest about: **two tasks in one repo running the same target *will* still
> collide on the port** unless the repo's own tooling varies it — the design's collision guarantee
> was traded away for predictability. If that bites, the remedies are (a) a per-task env stanza in
> the run-target config, or (b) revisiting port injection as an opt-in — flagged as an open
> question, not decided.

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

## Summary of guarantees (as shipped)
| Concern | Answer |
| --- | --- |
| Who owns a worktree? | Exactly one task, via `tasks.worktreePath` ✅ |
| When is it removed? | Only on explicit archive, gated on no-running-sessions + not-dirty (overridable via `force` / `deleteWorktree`; teardown script runs first) ✅ |
| Survives app restart? | Yes — tmux sessions + durable rows + on-disk worktree, reconciled on startup ✅ |
| Survives crash? | Yes (no content snapshot, by choice) ✅ |
| Worktree deleted outside acorn? | Detected — `TaskStatus.missing` flags it for repair ✅ |
| File collisions between tasks? | Solved (separate worktrees) ✅ |
| Port collisions (dev servers)? | **Diverged** — no per-task port; run targets declare their URL; same-repo same-target tasks can still collide (see the shipped-divergence note) |
| DB / cache / secret / test-state collisions? | **Not solved** — deferred to containers (still) |

