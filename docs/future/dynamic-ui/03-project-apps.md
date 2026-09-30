# Phase 3: project apps, drafts, and forks

Status: proposed, 2026-10-01. Depends on [phase 2](./02-task-pane.md).

## Goal

A useful task app outlives its task. The owner publishes it to the project, opens it from the left rail
without a task, and edits it later through a draft in any task.

## What the owner gets at the end

- **Publish to project** on a task app, on its card, in the Apps pane, and on the archive confirmation.
- An **Apps** source in the left rail listing the routed project's apps, each opening at a project
  route.
- **Edit** on a project app, which makes a draft in the current task or a new one.
- **Publish** on a draft, with a clear choice when the project app changed in the meantime.
- **Delete** and **Restore** for project apps.

## Starting point

- Phase 2's pane, drawer, state, and archive behaviour.
- The project-scoped pane pattern of HTTP, Linear, and Rollbar under `/p/:projectId/x/<plugin-id>/`,
  and rail source gating ([frontend](../../frontend.md), [panes](../../panes.md)).
- The reference panel's find-or-create-a-task action ([panes](../../panes.md#not-a-pane-the-reference-panel)).

## Requirements

### Publishing

1. **Publish to project** changes a task app's owner to the task's project and records the publishing
   task and revision.
2. After the first publish, the original task holds a draft linked to the project app at that revision,
   so iteration continues in the same task.
3. Publishing a draft replaces the project app's head with the draft's head, if the project app's head
   is still the revision the draft started from.
4. If it is not, the owner chooses **Publish as a new app** or **Replace anyway**. Nothing is replaced
   silently.
5. Every project revision records which task and session published it.
6. A draft starts with a copy of the project app's state. Publishing does not overwrite the project
   app's state, because other people may have changed it.

### Where project apps show up

7. The host plugin contributes one left-rail source, **Apps**, shown when the workspace has at least one
   project app. The owner can hide it like any source.
8. The list shows the routed project's apps. With none, it shows an empty state naming the project.
9. A row opens the app at a project route, with placement `project`.
10. An app that declares a task-scoped data source offers **Open in a task** in its project pane instead
    of failing.

### Editing a project app

11. **Edit** offers **Edit in this task** when a task is open, and **Edit in a new task** always.
12. **Edit in a new task** creates a task named after the app, with the draft and an editing session
    in it.
13. The Apps pane marks drafts and shows which project app each one edits.

### Deleting

14. **Delete** on a project app moves it to an **Archived apps** list on the Apps source's page. It
    stops appearing in the rail and in drafts' publish targets.
15. **Restore** brings it back at its last head. **Remove for good** deletes its files after a
    confirmation.

## Out of scope

- Workspace-scoped apps. See [refused](./refused.md#workspace-scoped-apps).
- Several people editing a project app. That is [phase 5](./05-teams.md).

## Steps and checkpoints

### 1. Publish

**Checkpoint 1.** Publish a task app. It appears under **Apps** in the left rail for its project and not
for another project in the same workspace. Archive the task. The project app keeps working.

### 2. Draft and publish again

**Checkpoint 2.** In the original task, ask for a change and publish. The project app moves to the new
head. Open the project app from the rail and confirm it.

### 3. Conflict

**Checkpoint 3.** Start drafts of one project app in two tasks. Publish the first. Publishing the second
offers **Publish as a new app** and **Replace anyway**, and each does what it says.

### 4. Edit in a new task

**Checkpoint 4.** From the rail, **Edit in a new task**. The task opens with the draft in its Apps pane
and an editing session that knows the app. Record how long the task took to become usable, because the
worktree is created when the session starts.

### 5. Task-scoped data

**Checkpoint 5.** A project app over the database plugin's task-scoped source offers **Open in a task**
from the rail, and runs once opened in one.

## Docs that change

- [Frontend](../../frontend.md): the **Apps** rail source.
- [Panes](../../panes.md): the project pane and drafts.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- How a left-rail source lists project-scoped rows for the routed project, in the HTTP plugin.
- The cost measured in checkpoint 4. If a new task is too slow for editing an app, see
  [the open questions](./README.md#open-questions).
