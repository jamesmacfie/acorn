# Phase 2: the task Apps pane, editing, and archive

Status: proposed, 2026-10-01. Depends on [phase 1](./01-inline-cards.md).

## Goal

A task's apps get a home in the task. The owner opens one full size from the right rail, changes it
through the conversation beside it, and keeps state in it. Archive and restore treat apps as part of
the task.

## What the owner gets at the end

- An **Apps** button in the task's right rail, once the task has an app, listing its apps.
- The selected app at full size, with an **Edit with agent** drawer holding the conversation that built
  it.
- Apps that remember things, such as ticked checklist items.
- An archive confirmation that says which apps go with the task, and apps that come back on restore.

## Starting point

- Phase 1's packages, tools, cards, revisions, and app trust.
- The `agents.conversation` client capability in `plugins/agents/src/contract/conversation.ts`, used
  by the workflows run pane.
- Pane gating with `when`, and archived previews through `readsArchived` ([panes](../../panes.md)).
- Archive and restore in `packages/node-core/src/server/storage/archive.ts`.

## Requirements

### The pane

1. The host plugin contributes one `list-detail` task pane, gated by `when` so a task with no app has no
   button.
2. The list shows each app's name, description, head revision, and when it last changed.
3. The detail runs the app's head with placement `pane`.
4. A card's **Open** goes to the app in this pane.

### Editing

5. The detail has an **Edit with agent** drawer that draws the building session's conversation through
   `agents.conversation`, composer included.
6. When the building session is unavailable, the drawer offers **Start an editing session**, which
   creates a session in this task with the app's name, description, file list, and head attached.
7. A new head from either the drawer or the main Agent pane moves the detail to it without a reload.

### App state

8. The bridge offers `state.read` and `state.write` for the app's own JSON document, at most 256 KiB.
9. State survives revisions. A revision that changes the state's shape handles the old shape itself;
   the host does not migrate.
10. `app_guide` documents state and includes the checklist example from phase 0.

### Archive and restore

11. The archive confirmation lists the task's apps and says they are archived with the task.
12. Archive unregisters the task's apps and keeps their files, revisions, and state.
13. The pane declares `readsArchived`. In an archived preview it lists apps, their revisions, and their
    files, read only, and does not run them.
14. Restore registers the apps again, at the head they had.

## Out of scope

- **Publish to project** on the archive confirmation. It arrives with [phase 3](./03-project-apps.md).
- Deleting a task app on its own. A task app goes when its task is deleted.

## Steps and checkpoints

### 1. The pane

**Checkpoint 1.** A task with no app has no **Apps** button. After an agent shows one, the button
appears, and **Open** on the card lands on the app in the pane.

### 2. The drawer

**Checkpoint 2.** Ask for a change from the drawer. The conversation there is the same one as in the
Agent pane, and the detail moves to the new head. Archive the building session in Agent Center, reopen
the drawer, and start an editing session. The new session knows the app without being told.

### 3. State

**Checkpoint 3.** Build a checklist app, tick two items, ask for a new column. The ticks survive the
new revision and a restart of the desktop app.

### 4. Archive and restore

**Checkpoint 4.** Archive the task. The confirmation names the app. The archived preview lists it and
does not run it. Restore the task. The app runs at the same head with its ticks.

## Docs that change

- [Panes](../../panes.md): the Apps pane.
- [Workspaces and tasks](../../workspaces-and-tasks/archive.md#restoring-a-task): apps on archive and restore.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- How the workflows run pane mounts `agents.conversation`, including the layout rule that the
  conversation must reach the pane region as a fragment.
- Whether archive has a hook the host plugin can use to unregister apps, or whether registration should
  follow the task's archived state on each read.
