# Worktrees and setup

A task with a branch runs in its own Git worktree. This page covers how the Node creates and
revalidates that worktree, the setup script, the files it copies in, and the shared `git status`
reads behind the rail markers. The code is in `packages/node-core/src/server/worktrees/`.

## Create a worktree

The Node creates a worktree the first time the editor, changes, terminal, preview, or an agent needs
files. A task with no branch uses the project folder directly.

The Node derives the path, and a client can't choose it. The directory is
`<owner>-<repo>-<branch slug>` under the worktrees root, from `worktreeBranchDirName` in
`pathGuards.ts`, and `isContainedPath` guards the result. A client can name a path in one case: an
**Existing worktree** at task creation. The Node accepts it only when Git lists it for that project
and no active task uses it.

A task can name a local branch as its base. acorn creates the task branch from that base's last
commit when it saves the task, then creates the worktree on first use. Uncommitted changes in the
base's checkout don't carry over, and remote-only branches aren't accepted. Without a base,
`git worktree add -b` starts from the project folder's `HEAD`. A remote-tracking ref such as
`origin/main` doesn't take precedence over local commits.

If another worktree or the project checkout has the task's branch checked out, Git refuses. acorn
reports the occupied branch and path from Git's worktree roster and leaves that checkout alone.
Release the branch there, then reopen the task to retry. Setup runs only after creation succeeds.

## Revalidate a worktree

The directory is keyed by owner, repository, and branch, so revalidation checks the branch as well
as the path. For a worktree the task already owns, the branch checked out on disk wins. If you check
out another branch in that worktree, the Node updates `tasks.branch` to match. Work that needs a
second pull request switches branch inside the one worktree. The directory keeps its first name,
because the stored path is derived again only when the task has no worktree.

The Node refuses a directory with no branch to adopt with a `worktree-stale` 409. That covers a
worktree that was pruned or moved, one on a detached HEAD, and one that holds another branch while
the task doesn't own it yet. It refuses a worktree it can't create with `worktree-unavailable`. It
doesn't fall back to the main checkout, because the fallback would hand the agent another branch's
files.

Read-only panes can treat a missing worktree as an empty root. Execution surfaces, managed agents
included, call the core task service's `requireRoot`, so a missing project mapping and a Git failure
stay separate errors.

On macOS, `packages/node-core/src/server/core/git.ts` retries with
`/Library/Developer/CommandLineTools/usr/bin/git` when Xcode's Git refuses because its license isn't
accepted.

## Run the setup script

The project's setup script runs in the new worktree as a terminal session titled "Setup", so you can
read its output. The task's rail row shows a pulsing dot under the task glyph until that session
exits ([rail controls](../ui-design/shell-hierarchy.md#rail-controls)).

The **New task** dialog offers **Skip setup script** for a Git worktree task. So does the box that
makes a task from an integration's item, **Start workflow…** included. The task stores the choice,
so setup stays skipped if another surface creates the worktree later or you restore the task.

To run setup by hand, open the command palette on the task and choose **Run setup script**. It
starts the same "Setup" session in the task's worktree and records a normal attempt. The command
appears when all of these hold:

- The project has a setup script.
- The task has a Git worktree of its own and isn't being archived.
- The last setup attempt was skipped by the user, by an **Off** trigger, or for lack of a script,
  or it failed or was interrupted.

The **Off** trigger only stops automatic runs, so the command still appears under it. It doesn't
appear before the worktree exists, while setup runs, or after setup succeeds. The Node makes this
decision and returns it as `setupRunnable` in task script status. The route is
`POST /v1/p/terminal/tasks/:taskId/setup`, and a refusal answers 409 with the reason.

[Task script results](./task-scripts.md) covers how the Node records each setup attempt.

## Copy files into a worktree

A project's `.acorn/config.toml`, committed or personal, can list `copy` paths. These are
repo-relative files, usually ignored by Git, such as `.env.local`, that the Node copies into a fresh
worktree so it works without a setup script. The repository's list replaces a personal list. It
doesn't merge with it.

The copy follows these rules:

- A missing source warns and doesn't fail worktree creation.
- The Node doesn't replace a destination that exists, link or file.
- Sources must be regular files. Both ends go through the task-root path guard, so a link outside
  either root or a dangling link is rejected with a warning.

## Worktree status reads

The rail and footer show a dirty marker and a changed-file count for each task. Both come from
`git status --porcelain=v2 --branch` in each active worktree. Every client asks for that sweep, and
the changes pane asks the same question for its list. Two clients over four worktrees would cost 16
processes for each poll.

`worktreeStatus.ts` runs one process per worktree per two seconds (`WORKTREE_STATUS_TTL_MS`).
Concurrent callers join the run in flight, and a caller inside the window gets that run's output.
The changes pane reads the same output, which is why the command carries `--branch`. The pane's two
`git diff --numstat -z` counts and its `rev-parse --git-dir` go through the same window by argument
list, in `worktreeGitText`.

Every read sets `GIT_CEILING_DIRECTORIES` to the worktrees folder. Without it, git climbs out of a
task folder that has lost its `.git` link and reports whichever repository holds the worktrees
folder. In development that's the acorn checkout, whose changes then showed on the task's rail icon.

These rules keep the cache honest:

- The Node drops every entry under a path when it writes there, runs in flight included. That covers
  a stage, a commit, a discard, a push, an editor save, a new worktree, and a terminal command going
  quiet. A change made outside acorn shows on the next poll past the window.
- One shared timer expires completed output when its window ends. A failed read leaves no entry.
- A retired entry keeps its admitted callers, and a late result can't refill it.
- A fresh read skips the window and the run in flight, then publishes its answer for later reads.

The sweep also observes each task's HEAD. Only the newest observation for a task can publish
`head:changed`. The first observation seeds silently, and an unknown HEAD keeps the last good one.
Four workers run the sweep's Git reads, and the client drives its clock.

**The cache serves reads, not refusals.** `removeWorktree` refuses to delete a worktree with
uncommitted changes unless forced, and a stale "clean" there would destroy work. So `worktreeDirty`
passes `fresh: true`, and a failure is never cached as clean. A test in `worktreeStatus.test.ts`
writes a file, waits 100 milliseconds, and expects the removal to be refused.

## Why there's no file watcher

A watcher would need a handle per directory where recursive `fs.watch` is missing. It would be a
second source of truth beside Git's, and its events would still feed this same coalesced read. Build
one only if a change made outside acorn has to show in under two seconds with no client asking.
