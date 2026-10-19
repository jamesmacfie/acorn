# Phase 5: project apps, drafts, and forks

Status: built, 2026-10-19, except requirement 10. Depends on [phase 4](./04-task-pane.md). The shipped
behavior is in [project apps](../../agent-built-apps/project-apps.md), which wins where this page
disagrees.

## Completion note, October 19, 2026

**What landed.** All in `plugins/trellis`, plus one export from the plugin API.

- **Owners and drafts.** `app.json` names `taskId` or `projectId`. A draft carries `draftOf`: its
  project app, the project revision it's at, and its own head at that point. A project app can carry
  `deletedAt`. Each project revision's `revision.json` records `publishedFrom`: the task, the task
  app and revision, and the session that last showed it.
- **Publishing.** `server/projectApps.ts` holds `publishToProject` and `startDraft`. The first publish
  copies the task app's head into a new project app with the task app's state, and links the task app
  as its draft. A later publish checks the expected head inside the project app's write queue
  (`publish` gained `expectedHead`), and answers 409 when it moved. `safe`, `replace`, and `new` are
  the three modes. Publishing over an existing project app leaves its state alone.
- **Routes**, all device only: `POST /apps/:appId/publish`, `POST /apps/:appId/drafts`,
  `PUT /apps/:appId/deleted`, and `DELETE /apps/:appId` for a deleted project app. The app list
  returns every field the client needs, owner, draft link, and deletion included.
- **Publish buttons.** `PublishButton.tsx` sits on the head card and in the Apps pane's toolbar. It
  reads **Publish to project** on a task app and **Publish** on a draft, is off when the project has
  the draft's head, and on 409 asks **Publish as a new app** or **Replace anyway**.
- **The archive dialog.** Trellis's task check adds a **Publish to the project first** checkbox when
  a task app has an unpublished head, and its `apply` publishes each one in `safe` mode.
- **The Apps source.** A compiled `list-detail` source at order 75 with routes
  `/p/:projectId/apps` and `/p/:projectId/apps/:appId`, gated on a live project app in the open
  workspace. `ProjectApps.tsx` draws the list, an empty state naming the project, **Archived apps**
  with **Restore** and **Remove for good**, and the detail with **Edit in this task**, **Edit in a new
  task**, and **Delete**. The detail runs the head at `$placement` `project` with no task.
- **Editing sessions.** The drawer's session start moved to `editingSession.ts`, so **Edit in a new
  task** starts the same session with the app attached. A draft's context says it's a draft.
- **The plugin API** exports `currentWorkspaceId`, because a source's `when` has no route to read.
- **The guide** says `$placement` is `project` in the Apps source, where there is no task.
- `app_list` names a draft's project app in `draftOf`.

**Decisions and deviations.**

- **The first publish copies instead of changing the owner field.** Requirement 1 reads as moving the
  task app to the project. Moving it would take the app ID away from the task, so the agent's next
  `app_show` and every card in the transcript would point at an app the task no longer owns. A copy
  keeps the ID the task knows, and the task app becomes the draft requirement 2 asks for.
- **Requirement 10 and checkpoint 5 aren't built.** No data source is task-scoped. The database plugin
  registers no data source, and the dashboard run scope carries a workspace and a project, never a
  task. The only task-scoped thing an app reads is the `task` host tool, which fails with a message
  at the `project` placement. **Open in a task** waits for a task-scoped source to exist.
- **Edit in a new task makes a project-folder task.** `createTask` without a branch makes one, as the
  reference panel's **Create task** does, which this phase was told to reuse. So no worktree is
  created, which mostly answers the README's open question. The editing agent runs in the project's
  checkout. The README records the trade.
- **One draft per project app per task.** A second **Edit** in the same task opens the draft it has,
  instead of making two drafts that would conflict with each other.
- **Edit in this task means the active task of the same project.** The Apps source is a project page,
  so "this task" is the shell's active task, offered only when it's in the routed project and not
  archived.
- **The archive dialog has one checkbox, not a button per app.** A task check's concern carries one
  action. One checkbox that publishes every unpublished app fits it with no new seam. A conflicting
  draft is skipped, so nothing is replaced silently.
- **A deleted project app is no draft's target.** Its drafts publish as a new app. After **Remove for
  good**, a draft lists "Draft of a removed app".
- **The Node service graph is 1,896,705 bytes**, 479 more than phase 4, under the 1,897,800 ceiling.
  `projectApps.ts` loads lazily with the routes, and the task check imports it on use. The terminal
  client's startup closure is unchanged at 756,927 bytes. The desktop renderer's compiled roster is
  332,280 bytes of 340,000, 2,222 more than phase 4, for the source's registration and the store's
  gate. The list and detail load on first open.

**Verify-before-building answers.** The HTTP plugin is a loaded plugin, and its project pane uses the
host-minted `/p/:projectId/x/<plugin-id>/` prefix. A compiled plugin's project page is a source with
`regions`, `projectScoped`, and its own routes, as Memory and GitHub do, reading `projectId` and the
item from `useParams`. Trellis follows that. The cost in checkpoint 4 is below.

**Checks run.** Unit tests: `plugins/trellis` (41, including the new cases in `routes.test.ts` and
`PublishButton.test.tsx`), `apps/tui/src/trellis.test.tsx`, the plugin API surface snapshot
(regenerated for `currentWorkspaceId`), the desktop client golden list (regenerated for the source),
the desktop rail parity list (regenerated), and the Node route and plugin golden lists (unchanged). The
full `pnpm lint` passed. In the full `pnpm test`, the desktop parity list was the one real red, since
fixed, and `plugin-examples` hit the known `pnpm pack` race. Both packages passed when rerun alone, the
desktop one with its Rust tests. Live, in a `pnpm dev:agent` window with a managed Claude Code session
(Opus 5.5, Auto mode) on a worktree task, with `document.hidden` faked as phase 4 describes:

- Checkpoint 1: passed. **Publish to project** on the card made the project app, and **Apps**
  appeared in the rail. A second project in the same workspace, added to the session's database, showed
  "scratch has no apps". After archiving the task, the project app opened from the rail and ran.
- Checkpoint 2: passed. A change asked in the original task made the draft v2, and **Publish** in the
  Apps pane moved the project app to v2 with `publishedFrom` naming the task and session. The rail
  drew v2, and the tick made in the project app stayed.
- Checkpoint 3: passed. With drafts in two tasks, the first publish made v3. The second asked, and
  **Replace anyway** made v4 from its head. Another round with **Publish as a new app** made a second
  project app and relinked that draft to it.
- Checkpoint 4: passed. **Edit in a new task** opened the task on its Apps pane with the draft 1.16
  seconds after the click. Its Agent pane held "Edit Release checklist" with the app attached, and
  "Rename the step 'Announced' to 'Announced in Slack'" changed the right app without naming it.
  No worktree was created. For comparison, `git worktree add` of this repository takes 1.0 to 1.3
  seconds with no setup script.
- Checkpoint 5: not run. See requirement 10 above.
- Also checked: **Edit in this task**, **Delete**, **Restore**, **Remove for good**, and the archive
  dialog's checkbox, which published the draft's head as v5.

Three things only the test window showed. "Add project…" opens a native folder picker the driver can't
reach, so the second project went straight into the session's database, and even after a restart the
project picker didn't list it, so the check routed to it by address. A window that reopens on an
`/apps/…` address draws Home, because the source's gate is false until the app list loads.
And the driver's two clicks on a confirm button arrive more than three seconds apart, after the arm
expires, so **Delete** and **Remove for good** were pressed from one page script. The terminal client
wasn't run live, for phase 3's reason.

**For later phases.**

- Phase 6 places project apps on Home. `AppView` and `Revision` take an optional task and the
  `project` placement, and a dashboard placement can follow the same path.
- A project app's state is last-write-wins across windows, as phase 4 noted. Nothing merges two
  people's ticks.
- Two project apps can share a name. **Publish as a new app** copies the draft's name, so a project
  can list two "Release checklist" rows. A rename isn't offered.
- The archive checkbox doesn't offer a draft whose project app was removed when the draft has no head
  of its own. **Publish to project** in the pane still does.

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

- Phase 4's pane, drawer, state, and archive behaviour.
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
9. A row opens the app at a project route, with `$placement` set to `project`.
10. An app whose plans read a task-scoped data source offers **Open in a task** in its project pane
    instead of failing.

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
- Apps on dashboards. That is [phase 6](./06-apps-on-dashboards.md).
- Several people editing a project app. That is [phase 8](./08-teams.md).

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
