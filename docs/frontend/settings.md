# Settings

This page covers the Settings layer: how it opens, its rail and groups, the page header and scope
chip, the page context, search and deep links, and keys inside it. Read it before you add a settings
page. It's part of [frontend](../frontend.md). [Settings pages](./settings-pages.md) covers how a page
saves, and [settings groups](./settings-groups.md) covers the core pages.

## Settings

Settings is a full-window layer, `packages/client-core/src/features/settings/SettingsView.tsx`, that
`apps/desktop/src/client/App.tsx` mounts over the shell, top bar included. It isn't a route, because a
route change would unmount the task's panes. The workspace stays mounted underneath, so a terminal, an
agent stream, or an editor keeps running and is where you left it after Escape.

These open it: ⌘,, the palette's **Open settings**, the top bar menu, `openSettings(target)` on a
slot's context, and the `presentation:open-settings` event. A target is
`settings/<pageId>#<sectionId>`, and the prefix and section are optional. With no target, Settings
opens on the last page used, which is kept in local storage and never sent to a Node.

### The rail

The rail holds **Back to acorn**, a search field, which `/` focuses, and nine groups: General,
Workspaces and projects, Agents, Connections, Features, Automation, Machines, Plugins, and Advanced
(`packages/protocol/src/chrome/settingsPages.ts`). A page declares its group as `category` and what a
change affects as `scope`, `device`, `node`, `workspace`, or `project`, on its `SettingsContribution`
(`packages/client-core/src/host/registries/shell/settings.ts`). A missing `category` is `features`, a
missing `scope` is `node`, and the older `group: 'workspace'` still means `scope: 'workspace'`.

A plugin can use General, Agents, Connections, Features, Automation, and Machines. Only core files
pages under Workspaces and projects, Plugins, and Advanced, and a compiled plugin that names one of
those, or an unknown scope, throws at registration. Workspaces are rows under Overview, and a
workspace's projects are rows under it while it's expanded.

The arrow keys move through the rail, and Enter opens a page. The rail's one Tab stop is the open
page's row, so Tab moves into the page. A dot beside a row marks an attention row that targets that
page.

A page is a column at most 960px wide, centered beside the rail, with the header's title and close
button over it. Below 900px, the rail is its own screen and a page opens over it with a back link. The
page is a size container, so below 32rem its inline rows stack, with the control under the words.

### The header and the scope chip

Above the title, a small path names what the page sits under: its group, and on a project its
workspace. The title line holds the page name, a scope chip, and the close button, an `x` with
**Esc** in its tip. The chip says **This device**, **Node: \<label\>**, **Workspace**, or
**Project**, with the Node named when there's more than one.

A page that reads and writes the Node in `context.scope.nodeId` sets `followsNodeSwitcher`, and its
chip becomes a Node switcher when the fleet has two or more Nodes. The switcher is local to Settings.
It starts on the active Node each time Settings opens and never changes `activeNodeId`, which would
remount the shell on another Node's cache. Switching remounts the page, so nothing from one Node shows
under another, and a form with changes asks first. Installed, Security and backup, Audit log,
Schedules, Run history, Telemetry, and Storage and memory follow it. Storage and memory passes the
switcher's Node to each section a plugin draws in its `core:storage` point. Every other Node page reads
the active Node, because a compiled page uses the ambient API client and a loaded frame is pinned to
the active Node, and its chip names that Node as text.

### The page context

The page context is `{ scope: { nodeId, workspace?, project? }, navigate(target, opened?), workspace?,
onWorkspaceDeleted }`. `navigate` asks first when a form holds changes, and `opened` runs once the page
is on screen. Every arrival draws the page afresh, so its own rail row goes back to its list.
`workspace` repeats `scope.workspace` until the next plugin API major version. On a project's page,
`scope.project` is the project and `scope.workspace` is its workspace. A page that no longer passes its
`requires` gate falls back to the first page, which says the page isn't available on this Node.

## Search and deep links

Search is built from declarations, never from rendered controls
(`packages/client-core/src/host/registries/shell/settingsSearch.ts`). A page declares `keywords` and
`sections`, at most 16 of each. A section is `{ id, label, keywords?, rows? }`: `id` matches a
`SettingsSection` the page draws, and `rows` lists its row labels. Core pages declare theirs in
`packages/client-core/src/features/settings/corePages.ts`, the table both the desktop's
`apps/desktop/src/client/pageContributions.tsx` and the terminal client register from, so a page is
findable before its chunk loads. A loaded plugin's settings frame declares `keywords` and `sections`
without `rows` ([the manifest](../plugin-authoring/the-manifest.md)). The index adds the names of
workspaces, projects, connections, Nodes, and plugins. The registry refuses a compiled page over the
limits, or whose section IDs repeat or can't be carried in a link.

Results rank page names first, then section names, row labels, and keywords. Within a rank, a match at
the start of the text beats one at the start of a word, which beats one anywhere. Each result names its
section, with its page as a faint step above, then the row or keyword that matched. A plugin is found
by its name and its ID. Enter opens the first result.

A result with a section scrolls to it and marks it for three seconds with an outline and a fill, which
show at once when motion is reduced. A deep link and a palette section row land the same way.
Reopening Settings on the remembered page doesn't scroll or mark anything.

A page that absorbs another keeps the old ID working through `aliases`. Each entry is `<oldId>` or
`<oldId>#<sectionId>`. A deep link, remembered page, or `openSettings` call that names an old ID lands
on the page that lists it, at that section, and Settings remembers the live ID after that
(`resolveSettingsAlias`). An alias is read only when no page has the ID. Limits and cost is the
example: `agent-concurrency` and `agent-pricing` land on its **Turns at once** and **Claude prices**
sections.

## Keys inside settings

While Settings is open, the task's chords stand down. `App.tsx` passes `taskActive: false` to the
dispatcher, and the region chords do nothing while focus is inside an `aria-modal` view
(`packages/client-core/src/host/keys/install.ts`). Focus moves into the rail on open, Tab stays inside
the layer, and focus returns on close, so keys typed in Settings never reach a terminal underneath.
Menus, select lists, and confirmations portal to the body and paint above the layer, and an open one
takes the first Escape.
