# Phase 4: the task Apps pane, editing, and archive

Status: built, 2026-10-19. Depends on [phase 3](./03-inline-cards.md). The shipped behavior is in
[agent-built apps](../../agent-built-apps.md), which wins where this page disagrees.

## Completion note, October 19, 2026

**What landed.** All in `plugins/trellis` except one change to the agents plugin.

- **The pane.** `paneContribution.ts` registers `apps`, a `list-detail` task pane at order 27 with a
  640px minimum width, `readsArchived`, and a `when` gate. The gate reads `appsStore.ts`, an in-memory
  list of every shown app on the Node from the new device-only `GET /v1/p/trellis/apps`. The Node sends
  an `app-changed` frame when a head moves, from `app_show` or **Restore**, and a two-minute client
  schedule is the backstop. The list shows name, description, head, and "Changed 4m ago". The detail
  runs the head with `$placement` `pane`, with no card frame. **Open** on the head card sends a
  `plugin:select` pane intent naming the app.
- **The drawer.** **Edit with agent** draws the building session through `agents.conversation`. The
  app sits in a kit `Section` above the conversation fragment, so the shell's existing rule caps it at
  40% of the column beside a transcript. `app.json` gained `sessionId`, written by `app_create` and
  every `app_show` from the tool context, and `updatedAt`.
- **Starting an editing session.** `AgentConversationSurface` gained `sessionOpen(sessionId)` and
  `startSession({ taskId, title, context, like })`. `startSession` creates an interactive session on
  the harness and profile `like` ran on, or the first installed one, with the context in
  `config.pendingForkContext`, which the composer already attaches to a new session's first draft.
  Trellis builds that context from the head's program and plans, the name, and the description, then
  names the new session on the app through `PUT /apps/:appId/session`.
- **App state.** `state.json` beside `app.json`, read and written through `/apps/:appId/state`, which
  takes only `$` keys and refuses more than 256 KiB with 413. `appState.ts` seeds a runtime with the
  saved values its revision declares, after lang-core's defaults, and saves what the program sets
  400 ms after the last change. Every interactive view of the head shares one query cache entry, so
  the card and the pane in one window stay in step. A view waits for the first read before drawing.
  The guide's sentence about state not being saved is replaced by which variables persist and how
  revisions keep them, and its checklist example says it remembers its ticks.
- **Archive.** A trellis task check names the task's shown apps in the archive dialog. Archive and
  restore needed no new code: apps are files keyed by task ID, which archive never touched. The
  archived preview lists each app's revisions as folds with their program and plans, and runs nothing.
  An app card whose task isn't in the active task list draws one line instead of the app.

**Decisions and deviations.**

- **The drawer opens below the app, not beside it.** The conversation's timeline must be the detail
  region's own child, so a side split would have meant a new layout or new shell CSS. A `Section`
  above it gets the cap the shell already gives the Agent pane's queue. A side drawer is a later
  layout question, if anyone wants one.
- **The building session is the last one that showed the app,** not the one that created it. A
  session started from the drawer becomes it at once.
- **An editing session's context is a draft attachment, not a sent turn.** Sending a turn on the
  person's behalf costs a model call they didn't ask for. The attachment rides `pendingForkContext`,
  whose name is a fork's. Renaming it would touch stored sessions for no behavior change.
- **Cards remember too.** The design says the host saves state. Saving only from the pane would leave
  the card beside it showing different ticks, so the head card saves through the same cache.
- **No archived flag on the Node.** Plugins get no task status from core, so the card asks the
  active task list. Until that list loads, a card counts as not archived.
- **The Node service graph is 1,896,226 bytes**, under the 1,897,800 ceiling. The task check, the
  frame, and `emits` are on the boot path. The terminal client's startup closure is 756,927 bytes of
  770,000, and the desktop renderer's compiled roster is 330,058 bytes of 340,000.

**Verify-before-building answers.** The workflows run pane mounts `AGENTS_CONVERSATION`'s
`Conversation` with `Dynamic`, as a fragment whose siblings are bars, never inside a `Stack`. The
Apps pane follows that. An archived task's transcript draws tool cards through the same
`agents:tool-card` point with the task's ID and no archived flag, so the app card checks the task
itself.

**Checks run.** Unit tests: `plugins/trellis` (37, including the new `routes.test.ts`), the terminal
render in `apps/tui/src/trellis.test.tsx`, the workflows run pane, the desktop client golden list
and the panes parity list (both regenerated for the pane and schedule), the Node golden lists, the
architecture rules, and the full `pnpm lint` and `pnpm test`. In the full run, slow server tests in
`plugin-agents` and `plugin-workflows` timed out under load. Both suites passed when run alone. Live, in a
`pnpm dev:agent` window with a managed Claude Code session (Opus 5.5, Auto mode) on a worktree task:

- Checkpoint 1: passed. No **Apps** button before the agent built a release checklist, the button
  after, and **Open** landed on it at full size.
- Checkpoint 2: passed. A change asked from the drawer moved the detail from v1 to v2 without a
  reload. After the building session was archived from the Agent pane, the drawer offered **Start an
  editing session**. The new session's first draft carried "Release checklist · v3". Asked only to
  "put a badge beside each step naming who owns it", it read the app and showed v4.
- Checkpoint 3: passed. Two ticks survived v2, a restore to v3, v4, and a restart with
  `dev:agent --reuse`.
- Checkpoint 4: passed. The dialog said "1 app belongs to this task" and named it. The preview listed
  four revisions with their programs and ran nothing, and the transcript's cards each drew one line.
  After restore the app ran at v4 with its ticks.

Two things only the test window showed. A `dev:agent` window runs hidden, and client schedules skip
their refresh while the host is hidden, so the gate's list never loaded until a script redefined
`document.hidden`. [Testing](../../testing/workflows.md) says how. And in that hidden window, the
detail followed an agent's new head 10 to 30 seconds late, as late as the transcript itself, while a
**Restore** click showed the new head in 303 ms. That looks like the hidden window throttling its
socket, not the pane, but it wasn't confirmed in a visible window. The terminal pane wasn't run live,
for phase 3's reason: the terminal launcher can't open the desktop session's sealed data root.

**For later phases.**

- Phase 5's project apps can reuse the pane's detail, `Revision` with a placement, and `appState.ts`.
  A project app's state is shared by everyone, so it wants the same last-change-wins rule across
  windows, which today only holds within one window. Another window's ticks arrive on its next open.
- A forked or editing session's attached context comes back on a reload if the draft was sent and
  emptied, because `pendingForkContext` stays on the session. That was already true for forks.
- **Publish to project** belongs beside each app in the archive task check, which can only say
  things. It needs a different seam.

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

- Phase 3's host plugin, library, tools, cards, and revisions.
- The `agents.conversation` client capability in `plugins/agents/src/contract/conversation.ts`, used
  by the workflows run pane.
- Pane gating with `when`, and archived previews through `readsArchived` ([panes](../../panes.md)).
- Archive and restore in `packages/node-core/src/server/storage/archive.ts`.

## Requirements

### The pane

1. The host plugin contributes one `list-detail` task pane, gated by `when` so a task with no app has no
   button.
2. The list shows each app's name, description, head revision, and when it last changed.
3. The detail runs the app's head with `$placement` set to `pane`.
4. A card's **Open** goes to the app in this pane.

### Editing

5. The detail has an **Edit with agent** drawer that draws the building session's conversation through
   `agents.conversation`, composer included.
6. When the building session is unavailable, the drawer offers **Start an editing session**, which
   creates a session in this task with the app's name, description, program, plans, and head
   attached.
7. A new head from either the drawer or the main Agent pane moves the detail to it without a reload.

### App state

8. The host saves the program's `$` variables to the app's own JSON document, at most 256 KiB, and
   seeds them when the app mounts.
9. State survives revisions by variable name. A variable a revision drops is discarded, and a new one
   starts at its declared default. The host does not migrate.
10. `app_guide` says which variables persist and includes the checklist example from phase 2.

### Archive and restore

11. The archive confirmation lists the task's apps and says they are archived with the task.
12. Archive keeps the task's apps, revisions, and state.
13. The pane declares `readsArchived`. In an archived preview it lists apps, their revisions, and their
    programs, read only, and does not draw them.
14. Restore brings the apps back at the head they had.

## Out of scope

- **Publish to project** on the archive confirmation. It arrives with [phase 5](./05-project-apps.md).
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
- How an archived task's transcript draws tool cards, so app cards there don't run queries.
