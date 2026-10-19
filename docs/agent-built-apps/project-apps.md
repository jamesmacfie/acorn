# Project apps

This page covers publishing a task app to its project, drafts and what happens when two of them
publish, the left rail's **Apps** source, editing a project app, putting one on a dashboard, and
deleting one. It's part of
[agent-built apps](../agent-built-apps.md).

## Publishing

A useful task app can outlive its task. **Publish to project**, on the app's card and in the Apps pane,
copies the app's head into a new app that the task's project owns. The task app becomes a _draft_ of
it: `draftOf` in `app.json` names the project app, the project revision the draft is at, and the
draft's own head at that point. The agent keeps editing the same app ID, so iteration carries on in
the task. The code is `plugins/trellis/src/server/projectApps.ts`.

A draft's button reads **Publish**. It's off while the draft has nothing the project app lacks.
Publishing replaces the project app's head with the draft's head, if the project app's head is still
the revision the draft started from. The check runs in the project app's write queue, so two drafts
can't both pass it. If the head moved, the Node answers 409 and the button asks: **Publish as a new
app** makes a new project app from the draft and links the draft to it, and **Replace anyway**
publishes over the newer head. Each project revision's `revision.json` records `publishedFrom`: the
task, the task app and its revision, and the session that last showed it.

A new project app starts with the draft's saved state. Publishing to an existing one leaves its state
alone, because other people may have changed it. A draft starts with a copy of the project app's
state.

The archive dialog offers **Publish to the project first** when a task app has a head its project app
doesn't. Ticked, it publishes each one on archive. A draft whose project app moved since it started
stays unpublished rather than replacing it.

## The Apps source

The left rail has one **Apps** source, never one icon per app. It shows when the open workspace has a
live project app, and the owner can hide it like any source. Its list is the routed project's apps.
With none, it says the project has no apps. A row opens the app at `/p/<projectId>/apps/<appId>`,
where the detail runs its head with `$placement` set to `project`. There is no task there, so
`Query("task")` fails with a message and `@ToAssistant` says to edit the app in a task.

## Editing

Editing needs a session, and sessions belong to tasks. **Edit in this task** shows when the active task
belongs to the same project, and makes a draft there. **Edit in a new task** creates a task named after
the app, makes the draft, starts an editing session with the app attached, and opens the task on its
Apps pane. A task keeps one draft per project app, so a second **Edit** opens the same draft.

The new task is a project-folder task, as the reference panel's **Create task** makes, so it creates no
worktree. Its agent runs in the project's checkout, and the app tools keep its edits in the data root.

## On a dashboard

**Add to dashboard**, on a project app's page and in its row's menu in the **Apps** source, lists the
Home tabs of the workspace that holds the project and puts the app there. On a task app's card,
**Publish and add to dashboard** publishes it first, the way **Publish to project** does, then adds the
project app. The cell's definition has no publication. It names the project and the app,
`{ "view": { "kind": "app" }, "app": { "projectId", "appId" } }`, so it always runs the app's head.
One app has one definition, and the same state, on every tab it's on. The code is
`plugins/trellis/src/client/AppCell.tsx` and `addToDashboard.tsx`.

The cell names the project and runs the head with `$placement` set to `dashboard`, sharing the project
app's state with its page. Its queries run again when the window regains focus, after a reported
plugin or account change, and at each plan's refresh interval, and its `Panel`s refresh as panels do.
Its menu adds **Open app** and **Edit in a new task** to the grid's layout items and **Remove from this
dashboard** ([cells a plugin draws](../dashboards/placements.md#cells-a-plugin-draws)). A deleted app's
cell says so and offers **Restore** and **Remove from this dashboard**. The cell has its own
**Restore** because the **Apps** source hides when its project has no live app. The Node's
measure sampler skips app cells, which have no measure of their own. The terminal client draws no
dashboards, so its **Add to dashboard** menu says they're in the desktop app.

## Deleting

**Delete** moves a project app to **Archived apps** at the bottom of the source's list. It leaves the
rail, its drafts publish as a new app, and its dashboard cells say it isn't available. **Restore** brings it back at its head. **Remove for good**
deletes its files after a confirm. The routes behind these, `/apps/<appId>/publish`, `/drafts`,
`/deleted`, and `DELETE /apps/<appId>`, are device only.
