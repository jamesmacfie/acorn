# Palette commands

This page covers what's in the palette: core's command tree, the commands each plugin contributes,
and why every row is a command. Read it before you add a palette row. It's part of
[command palette and shortcuts](../command-palette-and-shortcuts.md).

## Core's command tree

Core's own commands form a small tree:

- **Go to** holds the task, workspace, project, and Node searches and the **Last workspace** action
  (`packages/client-core/src/host/palette/navigationCommands.ts`). Going to a task or a workspace is
  a `fleet`-scoped search, so the root shows one named row instead of every task in the fleet. The
  palette switches Node before it activates a task on another Node.
- **Panes** and **Terminal** hold the task-scoped operations: showing, closing, pinning, and moving
  panes, and the drawer and a shell in the worktree (`apps/desktop/src/client/TaskView.tsx`).
- **Settings** holds one row per page the settings rail lists, in the rail's order, with the page's
  group as its hint. A workspace or project page has no row, because it needs a workspace or project
  to name. Then comes one row per section a page declares, titled **Page › Section**, which opens the
  page on that section. Both lists come from the index the settings search reads
  (`packages/client-core/src/host/registries/shell/settingsSearch.ts`), so the palette and the rail
  name sections the same way.
- **Appearance** and **Notifications** hold the settings core owns.

The terminal client registers one **Open settings** row instead of the Settings rows. Each of those
rows matches the Settings breadcrumb, so on that host they outranked the shell's own
**Notifications** and **New task** commands, and the terminal's Settings route lists every page
anyway ([terminal client](../tui/sources-and-settings.md) § Settings).

### One accessor for a setting

The palette doesn't read Settings pages to build commands. A page is an arbitrary component, and
reading one would tie the palette to rendering and add a second way to save. An owner opts a value in
by registering a `setting` command whose reader and writer are the ones its page already uses.
Appearance's five choices and the six notification switches are core's, in
`packages/client-core/src/host/registries/commands/coreCommands.ts`, over
`packages/client-core/src/features/settings/appearancePrefs.ts` and
`packages/client-core/src/features/notifications/settings.ts`. The host that contributes those
Settings pages registers their commands, so a client with no Appearance page has no Appearance
command.

### Openers for hidden rail sources

The desktop palette registers **Open \<label\>** at the root for every plugin source that can open
but that the rail isn't drawing (`packages/client-core/src/host/palette/sourceOpeners.ts`,
[frontend](../frontend/rail-and-routing.md) § Rail source visibility). The rows follow the availability list, so a
row disappears when its plugin unloads, loses trust, or its provider or workspace gate closes.
Picking one follows a rail click's project rule. A project-scoped source with no project to show
throws, and the palette shows the error. A plugin that ships its own `source.<id>.open` command, as
Docker, Agent Center, and GitHub do, keeps that row and gets no second one.

### Last workspace

**Last workspace** is an action, and it swaps the same pair of workspaces both ways.
`packages/client-core/src/features/workspaces/lastWorkspace.ts` holds the current workspace ID and the
one open before it. Each shell reports the workspace it settles on: the desktop from the route, the
terminal from its own choice. So opening a task in another workspace counts as a switch. Going back
reports the arrival too, which makes the workspace you left the way back. `⌘;` on the desktop and `;`
in the terminal swap the same two workspaces for as long as you keep pressing.

The store keeps an ID, not a Node, and the desktop looks the ID up in the fleet when you press the
key, so it finds a workspace on a Node that came back. The pair persists with the workspace restore
state on the active Node, so it survives a reload or relaunch. Both shells wait for startup restore
before they report the displayed workspace, and an explicit desktop URL to another workspace counts
as a visit. It's a toggle, not a history, and the row stays hidden until you've opened a second
workspace.

## Every row is a command

Every palette row is a command registered through `ctx.commands`. Ownership, capability gates, and
disposal come with the registration, so disabling a plugin removes its group and everything under it
at once. Live rows, such as the terminal's run targets, layout recipes, and sessions, or the workflow
definitions, are `search` commands.

The rules in `tools/arch/boundaries.test.ts` hold this shape:

- There's one `createCommandSession`, and both hosts build theirs from it.
- Neither host's palette files compose, fetch, rank, or run commands.
- No manifest frame target and no slot ID is the palette.
- A search response carries no field naming an action, a route, a URL, or a verb.
- There's no palette-row registry beside the command registry.

## What plugins contribute

Each plugin's list is short on purpose:

| Plugin | Commands |
| --- | --- |
| Editor | Quick open and find in files |
| GitHub | A changed-file finder, a pull request finder, create a pull request, and its rail source |
| Agents | Agent Center, a session search, the two harness terminals, and two settings |
| Docker | An open action and one search over containers, images, volumes, and networks |
| Terminal | A run-target search, a layout search, and a session search |
| Workflows | A definition search, a run search, and a create action |
| Database and HTTP | Their groups of saved rows and one submitted input each |
| Linear and Rollbar | An issue search each |
| Memory | **Search memory**, over names, descriptions, and bodies, which opens the file on the Memory page |
| Notes | A finder over three scopes and a create-a-note input |
| Changes, Context, and Preview | One open action each |
| Onboarding | None |

Each plugin's own doc lists its share under "From the command palette". Memory's edit, history,
restore, and import controls live on the Memory page
([notes and memory](../notes-and-memory.md#the-memory-page-and-transcript)).

Stopping an agent, removing a container, deleting a note, merging a pull request, and approving a
workflow gate aren't palette commands. Each needs context and a confirmation that a short row can't
carry, so they stay in the views that have both.
