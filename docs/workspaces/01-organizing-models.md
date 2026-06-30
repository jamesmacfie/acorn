# 01 — Organizing models: options & recommendation

The central design question is: **what is the top-level "thing" a user works on, and what does it
own?** Every comparable tool answers this differently. There are four answers in the wild.

## The four models

| Model | Examples | A "thing" *is* | Strength | Weakness |
| --- | --- | --- | --- | --- |
| **PR-as-unit** | Graphite, CodeRabbit, GitHub PR ext | the proposed change / review | Matches the social reality of shipping; great for reviewing & stacking dependent changes | The PR doesn't exist until you push — useless as the *home* for in-progress local work; tied to remote state |
| **Branch-as-unit** | plain git, VS Code branch switch | current HEAD in one working dir | Universal, zero infra | Serial — switching mutates one working dir; hostile to concurrency and long-running servers/agents |
| **Worktree-as-unit** | cmux, VS Code 1.103 worktrees | an isolated checkout + branch on disk | True filesystem parallelism; agents/servers don't clobber each other; cheap | Only *file* isolation (ports/DB still collide); lifecycle/teardown/ownership is the hard, under-solved part |
| **Task-as-unit** | **Conductor**, Wave | a unit of work that *owns* worktree + branch + terminal + diff + agent | Matches the user's mental model; bundles everything; PR/branch become derived outputs | Most opinionated to build; must own creation→archive lifecycle; risks divergence from raw git if the abstraction leaks |

## Competitive research

### Conductor (conductor.build) — task-as-unit
The clearest articulation of the model we want. "Each task gets its own workspace, branch, files,
terminal, diff, and review path." One agent runs per workspace. "New Workspace" runs
`git worktree add` on a fresh branch and copies only git-tracked files (so `node_modules` / `.env`
aren't duplicated — a per-workspace setup script handles those). A **left sidebar lists workspaces**
(a roster of parallel agents); selecting one opens a pane bundling chat/agent + terminal + diff +
review. The **PR is a terminal output**, not the identity: review the diff → open a PR → merge →
archive the workspace (tears down the worktree).
Sources: <https://www.conductor.build/>, <https://www.conductor.build/docs/>,
<https://news.ycombinator.com/item?id=44594584>

### cmux — worktree-as-unit, retrofitted
Open-source parallel-agent manager. Its own issue #3414 ("Per-pane auto git worktree + branch
isolation") admits the sidebar **doesn't natively know it's a worktree** — "branch metadata, GC, and
PR linkage all run on a half-aware foundation," and "nothing cleans the worktree on close, nothing
snapshots on crash, nothing tracks which pane owns which worktree." This is the cautionary tale:
worktree isolation without an *owning entity* leaves lifecycle unsolved. cmux also surfaces the
runtime-isolation gap (below).
Sources: <https://github.com/manaflow-ai/cmux/issues/3414>,
<https://github.com/andyrewlee/awesome-agent-orchestrators>

### Graphite & CodeRabbit — PR-as-unit
**Graphite** organizes around the **stack of PRs**: dependent PRs each building on the last, with
the `gt` CLI as the local↔remote bridge (`gt create`/`gt submit`, `gt up`/`gt down`). Concurrency is
expressed as *dependency* (up/down the stack), not independent lanes. **CodeRabbit** re-structures a
single PR's flat file list into **cohorts** (related hunks) and **layers** (contracts before
consumers), keyboard-driven, with a CLI (`cr`) for pre-PR review of the working tree. Both are
strongest at *reviewing* and weakest as a *home for in-progress local work*.
Sources: <https://graphite.com/docs/cli-quick-start>, <https://graphite.com/blog/stacked-prs>,
<https://docs.coderabbit.ai/pr-reviews/coderabbit-review>, <https://www.coderabbit.ai/cli>

### Warp & Wave — terminal-native
**Warp**'s primitive is the **block** (command+output); above it are tabs/panes each with their own
cwd. It has **no concept of a "task" or project unit** — users have explicitly requested it
(issue #9382). **Wave** is closer: a **workspace → tabs → widgets** model where a tab is a tiled
dashboard (terminal + files + web + ai), but binding to a git branch/worktree/PR is manual / by-cwd,
not first-class.
Sources: <https://docs.warp.dev/terminal/windows/tabs/>,
<https://github.com/warpdotdev/warp/issues/9382>, <https://docs.waveterm.dev/workspaces>

### VS Code / Cursor — folder-as-unit
Everything keys off the **open folder**: the Source Control view binds to its repo, the integrated
terminal cwd defaults to the workspace root. **Worktrees became first-class in VS Code 1.103**
(Aug 2025) — but opening a worktree means opening a **separate window**. So you get parallelism via
*multiple OS windows*, with **no single roster** of in-flight work — the opposite of Conductor's
single-window sidebar.
Sources: <https://code.visualstudio.com/docs/sourcecontrol/branches-worktrees>,
<https://github.com/microsoft/vscode/issues/257910>

### The "git worktree per task" consensus
Cross-cutting writeups agree: two agents in one working dir cause silent write-clobbering;
worktrees give each its own working dir + index while sharing one `.git` store (cheap, seconds to
create). Granularity is **one worktree per task**. The known ceiling: worktrees isolate *files*, not
*runtime* (ports, DBs, caches, env, test state still collide) — "best cost-to-isolation ratio for
**code-only** tasks (3–5 agents)"; beyond that you escalate to containers. Lifecycle/teardown is the
recurring unsolved pain.
Sources: <https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution>,
<https://nx.dev/blog/git-worktrees-ai-agents>

## Where acorn is today
Acorn is **PR-as-unit** (a PR review tool) with a **branch/folder-ish** terminal feature bolted on.
The vNext terminal/agent work is already drifting toward worktree-as-unit (Phase 4) but stopped at
the cautionary point cmux describes: worktrees exist as transient paths, with no owning entity, no
lifecycle, and no link to the PR or ticket they belong to.

## Recommendation: the generalized Workspace (task-as-unit)

**Adopt task-as-unit, call it a Workspace, and generalize the origin** so a Workspace can be created
from a GitHub PR, a Linear ticket, a Rollbar error, *or* plain local code. The Workspace owns the
repo + branch + worktree + linked PR + linked issues + panes; the PR becomes a derived artifact
(created from, or attached to, the Workspace), exactly as Conductor does.

**Why this and not the others:**
- **vs PR-as-unit** (today): a PR can't be the home for work that has no PR yet (local-first
  development, a Rollbar error you're investigating, a Linear ticket you've just picked up). We keep
  the cross-PR *browse* view (it's genuinely useful) but demote it from "the app" to **one Source**.
- **vs branch-as-unit:** serial by construction; can't hold several things in flight, which is the
  user's explicit requirement ("you might be looking at different pull requests at once").
- **vs worktree-as-unit (raw):** this is the right *isolation primitive* but the wrong *top-level
  object* — cmux proves that without an owning entity, lifecycle and linkage rot. The Workspace **is**
  a worktree-as-unit *with the owning entity bolted on*.
- **vs multiple OS windows (VS Code):** loses the single-pane roster the user wants ("tabs on the
  left… all the stuff you're working on").

**What we keep deferred (named here so it isn't mistaken for missing):** runtime isolation beyond
the filesystem (per-workspace ports/DB/containers) and crash-recovery snapshots. Near-term we solve
file isolation (worktrees) + a per-workspace dev-server command/port; containers are a later rung.
See [`05-lifecycle-and-isolation.md`](./05-lifecycle-and-isolation.md).

## Handling "several things at once"
The single-window **roster** (Conductor/Wave) is the right concurrency UI for acorn: a left-rail
list of in-flight Workspaces you click between, each showing live status (agent working, dirty
worktree, PR checks). We reject the multi-window (VS Code) and dependency-stack (Graphite) shapes —
the first has no roster, the second only models *related* work. Detailed in
[`02-ui-design.md`](./02-ui-design.md).
