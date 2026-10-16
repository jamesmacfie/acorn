# Phase 1: three levels and a top bar that names the task

Date: October 16, 2026. Status: done on October 16, 2026. Depends on nothing. Every later phase
depends on it.

## Completion note

Landed on October 16, 2026. The sidebar is always on Home, one task, or one conversation, with
Settings beside them. `apps/extension/src/sidebar/location.ts` holds the location, the moves, the tab
last picked in each task, and the stored destination. `TopBar.tsx` replaces `Header.tsx`. The task's
tabs are the kit's `Tabs`, the bottom bar and **Current task** are gone, and `agentsTask()` is deleted.
[Sidebar navigation](../../browser-extension/navigation.md) is a new reference page, because
`setup.md` went over 200 lines.

Decisions and deviations:

- `App.tsx` creates the location and draws the top bar and the offline strip. `Workspace.tsx` draws
  the tab strip, the page strips, and each level's body, and reports the top bar's title through
  `heading`. The Workspace stays mounted under Settings, so Settings no longer reloads it.
- The panel follows the page when the browser tab moves, and once when the Node's task list first
  arrives. A later task list moves nothing. Following every list change threw away Home's handoff card
  while a run was being retried, because the new task made the page its own. So **Create task** leaves
  the panel on Home, which shows the new task under **This page**.
- Following waits while a Node's stored location loads, then runs once.
- `TaskView` is `{ tab }`. The remembered conversation and run per task went, because an open
  conversation no longer moves with the page. A stored `workflows` tab reads as `runs`.
- `Destination` keeps its shape, because the right-click menu, the ask box, and Settings read its
  project. Home and Settings don't overwrite it. A step's conversation is stored as its task.
- **Runs** shows on every task once `workflow.runs` answers, and hides after it fails. A tab the task
  turns out not to have gives way to **Agents**.
- The kit's `TabDef` gained `marker`, an icon with a tone, a spin, and its meaning in words, and
  `TabDef` is exported from the layout entry.
- The acorn is the prototype's SVG, inline in `TopBar.tsx`. The kit's `Acorn` is ASCII art.
- **Go to task**, **Needs you**, and the ⋯ menus are left out. The task's title is plain text.
- The item strip reads "This page has no task", because the item's key isn't known until a lookup.
- Home's task row opens the task. A chevron beside it folds out the links that phase 3 removes.
- The panel goes Home when the Node's task list had the shown task and the next list doesn't. The
  background sends an empty list before its first read, so a missing task alone proves nothing. A
  task archived while the panel was closed comes back with an empty title until you press **Back**.
- Switching Nodes in Settings keeps Settings open. Pairing started there returns there.
- `pnpm dev:extension:ui click` also matches a button's accessible name, so it can press **Back** and
  **Settings**.
- Pairing's done screen says "Switch Nodes in Settings." Phase 11 removes that line.

For later phases:

- Phase 2: make the title in `TopBar.tsx` the **Go to task** button, and add the ⋯ menus there.
  Switching Nodes lives in Settings under **Use**.
- Phase 3: remove the links toggle, the button named "<title> links" in `Tasks` in `Home.tsx`.
- Phase 4: add **Needs you** to `TopBar.tsx` for Home, a task, and a conversation.
- Phase 5: the item strip and its **Start task** are in `pageStrip` in `Workspace.tsx`.
- Phase 6: the waiting context shows only under Home's **This page**, not on the **Agents** tab.
- Phase 8: `runsLive` in `Workflows.tsx` marks the tab. The view's label is `Runs`.
- Phase 9: draw the pull request's red dot with `TabDef.marker`.
- Tests: `apps/extension/src/test/sidebarUi.ts` has `goHome`, `openTask`, `tab`, `taskTabs`, and
  `shownTask`. A fixture's `tasks.pages` must list every task a test opens.

## Goal

The sidebar is always on Home, on one task, or in one conversation inside a task, and the top bar
says which. A task's panes sit in a tab strip under its name. The bottom bar goes. The panel follows
the browser tab only to a page that belongs to a task, and never throws away what you were reading.

## In the prototype

- Scenarios: **Principles and map**, **Moving between pages**, and **Node offline**. In **Principles
  and map**, click the browser tabs above the page and watch the panel follow.
- Notes: `overview` at line 1257, `follow` at line 1320, and `offline` at line 1325.
- Code: the navigation functions `openTask`, `openConv`, `goHome`, and `goPage` at lines 636 to 656.
  `topBar` at line 742 draws the bar for each level, `tabStrip` at line 774 the task's tabs, and
  `strip` at line 792 the one-line strip under the bars. `sidebar` at line 1168 puts them together.
  The `back` action at line 1462 says where Back goes.
- Today: `references/extension-ux/today/04-home-task-page-dark.png` and `05-agents-dark.png`.

## Starting point

- `apps/extension/src/sidebar/App.tsx` holds the view as one of `home`, `agents`, `workflows`,
  `settings`, or `panel:<pluginId>`, and draws the bottom bar from `TABS` with the client's
  `RailTab`. Workflows shows only for a task with runs, and a plugin panel only for a task it has one
  for, so tabs come and go as you browse.
- `Header.tsx`, since replaced by `apps/extension/src/sidebar/TopBar.tsx`, drew the top bar: a heading, with an eyebrow and Back for
  an open conversation, and a chip with the selected Node and a menu to switch, pair, and forget.
- `apps/extension/src/sidebar/Workspace.tsx` owns the state. `agentsTask()` at about line 181 picks
  the subject: the page's task, or the current task when the page is on its project's site. That rule
  is the hidden subject this phase removes. The effect at about line 500 decides where the sidebar
  goes when the page moves.
- `apps/extension/src/localState.ts` already keeps a `TaskView` per task, the tab, conversation, and
  run last shown, through `rememberTaskView` and `saveTaskViews`. It also keeps a `Destination`, the
  current task and conversation.
- `apps/extension/src/sidebar/Home.tsx` draws a **Current task** section with `CurrentTask`.

[The panel's views](../../browser-extension/setup.md#the-panels-views) and
[moving between pages](../../browser-extension/task-pages.md#moving-between-pages) document the
behavior this phase replaces.

## The design

### Levels

The sidebar's location is one of these:

```ts
type Location =
  | { level: 'home' }
  | { level: 'task'; taskId: string; tab: TaskTab }
  | { level: 'conversation'; taskId: string; sessionId: string; from: 'agents' | 'runs' }
  | { level: 'settings' }
type TaskTab = 'agents' | 'runs' | `panel:${string}`
```

Bridge setup and pairing stay outside it, as full-screen states that phase 11 redraws. The subject
task is `taskId` and nothing else. Delete `agentsTask()` and the "current task on its project's site"
rule. Rename the `workflows` tab to `runs` here, since phase 8 calls the tab **Runs**. Keep the stored
value readable: map a stored `workflows` to `runs` when you load a `TaskView`.

Keep the location in one signal, in a small module of its own such as `sidebar/location.ts` (new),
with the moves as functions: `openTask(taskId, tab?)`, `openConversation(sessionId, from)`,
`goHome()`, `openSettings()`, and `back()`. The prototype's versions at lines 636 to 646 are the
specification. `openTask` with no tab uses the task's remembered tab, and falls back to Agents when
the task no longer has that tab.

`back()` goes up one level. From a conversation, it opens the task on the tab the conversation came
from: Runs for a step's conversation, Agents otherwise. From a task or Settings, it goes Home.

### The top bar

Draw the top bar from the level, as `topBar` at line 742 does:

- **Home**: the acorn mark with a status dot, green when the Node answers and red when it doesn't,
  then a **Go to task** button with **⌘K** that fills the row, then the **Needs you** button and the
  Settings gear. Phase 2 makes **Go to task** work, and phase 4 adds **Needs you**. Until then, leave
  both out.
- **Task**: Back, then the task's title over its project and branch in small type, with a
  **This page** tag when the page beside the panel belongs to it, then a chevron. The title opens **Go
  to task**. Then **Needs you** and the task's ⋯ menu, which phase 2 fills.
- **Conversation**: Back, then the conversation's title, with the task's title above it in small
  type, or the run's name for a step's conversation. Then **Needs you** and the conversation's ⋯
  menu.
- **Settings**: Back and the word Settings.

The Node chip leaves the top bar. Phase 2 moves switching Nodes into the **Go to task** footer, and
phase 10 moves **Forget** into Settings. Until phase 2 lands, keep a way to switch Nodes in Settings.

### The tab strip

Under a task's top bar, draw the kit's `Tabs` from `packages/client-core/src/kit/components/layout/Tabs.tsx`,
one tab per pane the task has:

- **Agents**, always. It carries the desktop's Agent button markers: an alert when an agent waits on
  you, else a spinner while one works. `agentCounts` in `apps/extension/src/taskPages.ts` and
  `agentRailMarkers` already compute these for the bottom bar.
- **Runs**, whenever the Node runs the workflows plugin, which `workflow.runs` failing tells you. A
  spinner while a run runs. The prototype shows Runs only for a task with a run, but phase 8 starts a
  run from this tab, and a task with no run would have nowhere to start its first one.
- One tab per plugin panel the task has, with the plugin's glyph. Phase 9 adds the pull request tab's
  red dot when its checks fail.

A tab the task lacks isn't drawn, which is expected under a task. A task's tab list changes only when
the task changes, or a plugin panel appears or goes. Keep the open tab drawn while its view loads, as
`App.tsx` does today, so a tab doesn't vanish under the person.

Remember the tab per task in `TaskView`, which `localState.ts` already keeps, when the person picks it.

### Following the browser tab

Replace the page-move effect in `Workspace.tsx` with the rule in `goPage` at line 648:

1. Bridge setup, pairing, and Settings never move.
2. A page that belongs to no task leaves the panel where it is. Today, Agents, Workflows, and panel
   tabs fall back to Home, so following a link from a pull request throws away what you were reading.
3. An open conversation stays open, because people visit pages to capture them into it.
4. Otherwise, a page that belongs to a task opens that task, on the tab last used there.

### The strip

Under the bars, draw at most one strip, chosen in this order, as `strip` at line 792 does:

1. The Node is offline: a red mark, "**This computer** is offline" with the Node's name, and
   **Retry**. The acorn's status dot turns red. Content stays readable.
2. The page belongs to another task than the one shown: the page's mark, "This page is in **task
   title**", and **Switch**, which opens that task.
3. The page carries an issue no task holds: the plugin's mark, "**ENG-1234** has no task", and **Start
   task**, which goes Home, where phase 5's card waits.

### Home

Remove the **Current task** section and `CurrentTask` from `Home.tsx`. Home lists **Needs you**,
**This page**, and **Tasks**. Phases 3, 4, and 5 redraw those sections. In this phase, a row in the
task list opens the task with `openTask`.

### Opening from elsewhere

Every way into a conversation goes through `openConversation`: a notification's
`openRequest`, a task chip's **Show in side panel**, and a request row's **Open chat**. Every way
into a task goes through `openTask`. The task chip's `showTask` opens the page's task, not Home.

## Changes

1. Add the location module and its moves. Port each caller in `Workspace.tsx` and `App.tsx`
   to it: `showAgents`, `showWorkflows`, `showTab`, `back`, `goHome`, `openConversation`,
   `chatInTask`, and `startedHandoffWorkflow`.
2. Replace `Header.tsx` with a top bar drawn from the location, as above. Keep its file name or
   rename it to `TopBar.tsx`. Until phase 2 lands, move the Node switcher into Settings.
3. Add the tab strip and remove the bottom bar and `TABS` from `App.tsx`.
4. Delete `agentsTask()` and every read of it. The subject is the location's `taskId`.
5. Replace the page-move effect with the four rules above. Keep `TaskView` for the remembered tab.
6. Add the strip, and move today's offline message into it.
7. Delete the **Current task** section.
8. Update `App.test.tsx`, `ProjectSites.test.tsx`, and the other sidebar tests that click the bottom
   bar or read **Current task**. Add tests for `back()` from each level, for each of the four
   following rules, and for the strip's order.
9. Rewrite [the panel's views](../../browser-extension/setup.md#the-panels-views) and
   [moving between pages](../../browser-extension/task-pages.md#moving-between-pages).

## Out of scope

What each level draws inside it. Phases 3 to 9 redraw Home, the tabs, and the conversation. In this
phase, each tab keeps drawing today's content.

## Acceptance

- With a pull request open beside the panel, the panel shows that task, with its tabs, and the top
  bar names it with **This page**.
- Following a link from the pull request to a page no task holds leaves the panel on the task and
  tab it was on.
- With a conversation open, switching to another task's page keeps the conversation and shows the
  **Switch** strip. **Switch** opens that task.
- Back from a step's conversation opens Runs. Back from any other conversation opens Agents.
- Returning to a task opens the tab last used there, after the panel closes and opens again.
- Stopping the Node shows the offline strip within the time the status event takes today, and
  **Retry** reconnects.
- No bottom bar, and no **Current task** section.

## Risks

`Workspace.tsx` is 37 KB of interlocking effects, and its comments record why each exists. Read
those comments before you delete an effect. Several guard against a slow reply filling the wrong
list after a move. Keep those guards.

An effect that reads `agentsTask().taskId` re-runs on every `tasks.pages` broadcast, even when the
task hasn't changed. Read the location's `taskId` through a `createMemo` so a broadcast that leaves
the task alone reads nothing again.
