# Task creation and navigation

This page covers the **New task** dialog, how the Node picks and checks a branch name, the child
tasks that workflows and delegation create, and how the rails order tasks.

## The New task dialog

The rail creates a local task from a project. For a Git project it derives a branch from the title.
The dialog offers three sources, one tab each:

- **New worktree** creates a branch and a worktree. A collapsed **Advanced** section holds **Branch
  name** and **Branch from**. The base defaults to the branch checked out in the project folder. The
  list groups local branches that active tasks use by task title, then shows the other local
  branches. Helper text says that uncommitted changes don't carry over.
- **Project folder** creates a branchless task in the project folder.
- **Existing worktree** lists linked worktrees that no active task uses, and skips detached and
  prunable ones. The task takes that folder and branch, and setup doesn't run.

A project that isn't a Git checkout hides the branch options. Typing in **Branch name** keeps your
value, and title changes stop updating it.

The desktop rail opens `TaskDraftDialog` with the visible projects from its workspace and the selected
Node captured at that moment. `taskDraftStore.ts` owns the unsaved fields, Git reads, availability
request, and save state for that dialog. A workspace switch does not replace its project choices. A
Node switch closes the dialog, and a response from a closed dialog cannot enable a later one. The
task mutation carries the captured Node through creation, setup notification, or rename. The rail
continues to own task rows, source selection, context menus, drag, and navigation.

## Branch names

The Node adds `-2`, `-3`, and further suffixes to a title-derived branch until one is free. The
dialog previews that final name without an error. A name you typed exactly shows "This branch name
already exists in another worktree" when it's taken. **Create** stays disabled while the preview
runs. If the lookup fails, you can still submit, and the create route checks again.

The Node checks active task reservations, the derived directory, and Git's worktree roster,
including the project checkout. Two branches that map to the same directory conflict. With a base
selected, every local branch name counts as taken, so the base can't be ignored. Without a base, a
local branch with no worktree is free to reuse.

Creation serializes branch allocation and row reservation, child tasks included. An exact conflict
returns a `worktree-unavailable` 409. If saving the row fails, acorn removes only a branch that
request created. **Existing worktree** uses its own ownership check.

`slugifyBranch`, `dedupeBranch`, and the other name rules are in
`packages/protocol/src/projects/branch.ts`.
Provider promotions keep a seeded branch, resolve or create the project and the task link, and reuse
a task that already has that exact link.

## Child tasks

Core creates workflow and delegated-agent child tasks through `CoreServices.tasks.createChild()`.
The caller can reserve the child ID first. Replaying the same parent, title, branch seed, and ID
returns the same task. Reusing that ID for another parent or seed fails. Branch deduplication still
counts every other task, because two tasks can't share one worktree. Creating the task doesn't
create its worktree.

A workflow dispatch reserves each child ID before it calls `createChild`. The child keeps the
parent's project and records the parent in `Task.parentId`. The workflows plugin stores run lineage
separately and doesn't infer it from the title. A Git project gives the child a unique branch and the
usual worktree. A folder project has no branch isolation, so the child shares the project folder.

Finishing, failing, cancelling, or retrying a workflow doesn't archive its child tasks or remove
their worktrees. They stay in the rail with their final runs until you archive them. Retrying a
dispatch reuses its tasks and runs. Starting a root workflow again creates a fresh set.

## Rail order and grouping

The desktop stores task order, layout, the last pane and source, and drafts for each Node. `⌘1` to
`⌘9` activate the matching visible task.

The desktop and terminal rails place a child after its parent, from `Task.parentId`, and keep the
stored order among roots and siblings. A child is a normal task with its own panes. An orphan or a
cycle shows as a top-level row instead of disappearing.

Workflow-created tasks carry the origin `workflows:child`. The rails collapse them under the nearest
ordinary root task and show combined running and attention markers on that root. Expanding a root
shows the parent and child order, and opening a descendant reveals only its ancestors. Manual
children and top-level tasks keep their drag order and stay visible. Collapse changes no task
identity or lifecycle: each task keeps its own archive action, and there's no workflow group.

A run-history link to an archived or missing child says so, and keeps the record and attempt
history.
