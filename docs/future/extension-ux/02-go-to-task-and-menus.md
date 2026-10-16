# Phase 2: Go to task, and the task and conversation menus

Date: October 16, 2026. Status: done on October 16, 2026. Depends on [phase 1](./01-navigation.md).

## Completion note

Landed on October 16, 2026. **Go to task** opens from Home's top bar button, a task's title, and ⌘K
or Ctrl+K at every level, Settings included. A task's ⋯ menu holds its Acorn links, its pages, and
Settings. A conversation's ⋯ menu holds its Acorn links and **Archive chat**, which calls the new
`session.archive` bridge operation. Home's task rows lost their links fold-out, and the conversation
lost the links under its header. [Sidebar navigation](../../browser-extension/navigation.md) has a
new **Go to task** section and documents both menus.

Decisions and deviations:

- The palette, `sidebar/GoToTask.tsx`, isn't the kit's `Picker`. `Picker` owns its trigger button
  and anchors to it, and this palette has three ways to open it and none of them is its own button.
  It draws `PickerRow` and the picker's classes on the kit's anchored popover instead, so it looks
  like a picker without changing `Picker`. `group` wasn't added to `Picker`, because nothing calls it
  yet. Phase 5 adds it with its project picker.
- To get there, `@acorn/client-core` now exports `./kit/lib/anchor` (`createAnchoredPopover`) and
  `./kit/keys/trap` (`restoreFocusOnCleanup`, so Escape puts focus back where it was).
- The palette reads no tasks. `tasks.pages` already returns every active task with its title,
  branch, and project, from the same Node route as `tasks.list`. So no `tasks.list` reads, and no
  `projectId` change to it.
- The keyboard cursor uses `PickerRow`'s `active` mark. The task the top bar names is marked with a
  check in the row's leading slot instead, and Home's row has the house there. Rows have no state
  icon yet, because phase 3 defines it.
- ⌘K and Ctrl+K both work everywhere, as the composer's ⌘↩ does. The button shows ⌘K on a Mac and
  ⌃K elsewhere, through `formatChord`. ⌘K also closes the palette when it's open.
- `GoToTask` is drawn by `Workspace.tsx`, which has the projects and workspaces. `App.tsx` owns
  whether it's open, the top bar element it hangs under, and the key. Its footer names the Node with
  the acorn's dot colours. **Switch Node** opens Settings.
- The menus are in `sidebar/TopBarMenus.tsx`, and `App.tsx` passes them to `TopBar` as `menu`. **Open
  in Acorn** in a menu follows the link through a detached anchor's click, the same way the panel's
  `<a>` links reach the desktop. Where `opensLinks` is false, only **Copy Acorn link** shows.
- A page row in the task menu says **This tab**, **Switch to tab**, or **Open** when no tab shows it,
  as Home's fold-out did, and an app says its state. A GitHub pull request reads "Pull request #N".
  Other pages read as their host and path.
- **Archive chat** goes back with `back()`, so a step's conversation returns to **Runs**. After the
  archive, `App.tsx` bumps an `archives` counter, and `Workspace.tsx` reads the task's conversations
  again instead of waiting for an agent hint.
- A workflow step's conversation links to its run's task, not the step's own child task, which only
  `Workspace.tsx` knows. Pass that task up through `Heading` if the desktop link turns out wrong for
  a step.
- The sidebar's generic button and field rules centred the palette's rows and boxed its filter field.
  `sidebar.css` overrides both for `.go-to-task` only. The **New chat** picker has the same centred
  rows. Phase 6 should check it.

For later phases:

- Phase 3: Home's task row is now a single `.row-button` in an `li` with no class. The links are
  gone. The palette's rows want the state icon you define, in `GoToTask.tsx`'s `leading`.
- Phase 4: the top bar's `menu` slot sits at the right of a task and a conversation. Put **Needs
  you** before it.
- Phase 5: add `group` to the kit's `Picker` for the project picker. `GoToTask.tsx`'s
  `.go-to-task-group` label shows the look.
- Phase 7: the conversation's subhead now holds only the agent name and state.
- Tests: `ProjectSites.test.tsx` has the palette and menu helpers: `commandK`, `press`,
  `paletteRows`, `menuItems`, and `choose`. Menus and the palette draw in a portal on
  `document.body`, not in the test's root.

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
