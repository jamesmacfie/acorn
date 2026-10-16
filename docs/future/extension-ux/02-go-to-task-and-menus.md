# Phase 2: Go to task, and the task and conversation menus

Date: October 16, 2026. Status: proposed. Depends on [phase 1](./01-navigation.md).

## Goal

**Go to task** works like the desktop's palette: type to filter every open task, grouped by workspace
and project, with the page's task first. **⌘K** opens it anywhere in the panel. The selected Node
sits in its footer. A task's links and a conversation's links move into ⋯ menus, out of the rows and
headers where they crowd today.

## In the prototype

- Scenario: **Go to task**. Also open the ⋯ menu in the task's top bar in **Agents**, and in the
  conversation's top bar in **Conversation**.
- Notes: `switcher` at line 1319, and the first bullet of `conv` at line 1307.
- Code: `switcherView` at line 1124 draws the palette and its footer. `menuView` at line 1139 draws the
  `task` and `conv` menus. The `task` menu's **Pages** group lists the task's pull requests and apps,
  each switching to its tab.
- Today: `references/extension-ux/today/20-node-menu-dark.png`, the Node chip menu this replaces.

## Starting point

- No palette exists in the sidebar.
- Phase 1 took the Node chip out of the top bar, `apps/extension/src/sidebar/TopBar.tsx`. Settings →
  **Nodes** switches with **Use**, pairs, and forgets.
- Home's task rows in `apps/extension/src/sidebar/Home.tsx` expand to show **Switch to tab**, **Open
  in Acorn**, and **Chat**. `apps/extension/src/sidebar/OpenInAcorn.tsx` draws **Open in Acorn ↗**
  and **Copy Acorn link**. `apps/extension/src/acornLinks.ts` builds the links.
- `apps/extension/src/sidebar/openTabs.ts` switches to a task's open tab or opens a new one.
- The bridge reads tasks one project at a time with `tasks.list`. `tasks.pages` returns every active
  task with its page addresses, which may be none. The sidebar keeps it as the Node's task list.
- No bridge operation archives a conversation. The agents plugin archives one with
  `PATCH /v1/p/agents/sessions/:id` and `{ archived: true }`.

## The design

### Go to task

A popover under the top bar, as wide as the panel less a margin. It holds:

1. A filter field with the placeholder "Go to task", focused on open, and **esc** at its right.
2. A **Home** row first.
3. A **This page** group with the page's task, when the page has one.
4. One group per project, labelled "Workspace › project", in the order `projects.list` returns. The
   page's task isn't repeated here.
5. "No open task matches." when the filter leaves nothing.
6. A footer: a dot for the Node's state, the Node's name, and **Switch Node**, which opens Settings.

Each task row has the state icon phase 3 defines, the title, and the branch in monospace, or
"Project checkout" for a task with no branch. The task shown in the top bar has a check. Typing
filters by title and branch. Arrow keys move, Enter opens, and Escape closes.

Build it on the kit's `Picker`, `packages/client-core/src/kit/components/inputs/Picker.tsx`, in its
callback form, with `footer` for the Node line. The `Picker` has no group labels. Either add a
`group` callback to it, which the desktop's pickers can also use, or draw this one list with
`PickerRow` directly. Prefer adding `group` to the kit: phase 5's project picker needs the same thing.

For the tasks, read `tasks.list` for every project in parallel when the palette opens, through the
cache `Workspace.tsx` already keeps in `taskLists`. A Node with dozens of projects would make that
slow. If it does, add an optional `projectId` to `tasks.list`, with no project meaning every project,
rather than a new operation.

### ⌘K

Bind **⌘K** on macOS and **Ctrl+K** elsewhere on the sidebar's document. Format the key with the
kit's `formatChord`, which the sidebar already imports. The top bar's **Go to task** button and the
task title in a task's top bar open the same palette.

### The task menu

The ⋯ in a task's top bar opens the kit's `Menu` from
`packages/client-core/src/kit/components/overlays/Menu.tsx`:

- **Open in Acorn**, and **Copy Acorn link**.
- A **Pages** group, when the task has any: each pull request or published app, with "This tab"
  when it's the page beside the panel, "Switch to tab" otherwise, and the app's state for an app.
  Choosing one switches to its tab through `openTabs.ts`.
- **Settings**.

### The conversation menu

The ⋯ in a conversation's top bar holds **Open in Acorn**, **Copy Acorn link**, and **Archive
chat**. Archiving goes back to the task's Agents tab.

Add a `session.archive` bridge operation with `nodeId`, `sessionId`, and `key`. The host sends
`PATCH` with `{ archived: true }` to the session's route and returns `{ nodeId, sessionId }`.

### Open in Acorn where no desktop opens links

`opensLinks` already tells the sidebar whether this build runs beside a desktop that opens
`acorn://` links. Where it doesn't, **Open in Acorn** is left out of both menus, and **Copy Acorn
link** stays.

## Changes

1. Add the palette component, such as `sidebar/GoToTask.tsx` (new), and open it from the top bar,
   the task title, and ⌘K.
2. Add `group` to the kit's `Picker`, with a test in the kit, or draw the list with `PickerRow`.
3. Move the Node's name and state into the palette's footer. Remove the Node chip from the top bar
   if phase 1 left it.
4. Add the task and conversation menus. Remove the links from Home's task rows and from under the
   conversation header.
5. Add `session.archive` to the protocol, the host, the host's tests, and
   [native messaging](../../browser-extension/native-messaging.md).
6. Test the palette's groups, the filter, the keys, and the footer. Test each menu entry, including
   the archive call and where it leaves the sidebar.

## Acceptance

- ⌘K opens **Go to task** from Home, a task, a conversation, and Settings.
- With a pull request beside the panel, its task is first, under **This page**.
- Typing part of a branch name finds the task.
- **Switch Node** opens Settings.
- A task's ⋯ menu lists its pull request, and choosing it switches to that browser tab.
- **Archive chat** archives the conversation, which no longer shows in Agents or on the desktop's
  list.

## Risks

A side panel takes keyboard focus only after a click into it, so ⌘K works only once the panel has
focus. That's the browser's rule, and the top bar's button covers the first open.
