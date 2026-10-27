# Node-scoped pickers: one selected Node for the top bar and Settings

Date: October 27, 2026. Status: implemented October 27, 2026. The palette stays fleet-wide, as
recommended below.

With two or more Nodes paired, the top bar has a Node selector. Picking a Node should narrow
everything beside it to that Node. Today it doesn't. The workspace picker lists every Node's
workspaces, and Settings keeps a Node choice of its own. This plan makes the selected Node,
`activeNodeId()`, the one answer to "which Node am I looking at" in both places.

[Settings](../frontend/settings.md) owns the Settings layout and its Node chip.
[Client state and fleet behavior](../architecture/fleet.md) owns the fleet rules. Both pages win if
this plan disagrees with them, and both change when it lands.

## The problem

### The workspace picker lists every Node

`App.tsx` builds the top bar's workspace list with `createFleetWorkspaces()`
(`packages/client-core/src/features/workspaces/fleetWorkspaces.ts`). That function asks every paired
Node for its workspaces, projects, and preferences, then merges the answers in Node order. Nothing
filters the list by the selected Node. The only sign of where a row comes from is a ` · <Node label>`
suffix (`Topbar.tsx`, `rowLabel`).

What the owner sees:

- With workspaces on, the dropdown holds both Nodes' workspaces. Two Nodes that each have a
  **Default** workspace show two **Default** rows.
- With workspaces off, every project is its own row in the same picker, so another Node's projects
  appear in the **Project** dropdown. This is the "wrong projects" report.
- Picking a row from another Node calls `selectFleetWorkspace`, which switches the active Node and
  then navigates. The picker is a second, unlabelled Node selector.

The workspace rail (`WorkspaceRail.tsx`) draws the same list, grouped by Node, when it replaces the
top bar picker. The project dropdown beside the workspace picker (`scopedProjects` in `App.tsx`)
already reads only the active Node, so it isn't part of the problem.

Data doesn't leak between Nodes. Each Node has its own `QueryClient` (`clientFor(nodeId)`), and the
fan-out reads each one separately. The problem is only which rows the picker offers.

### Settings keeps its own Node

`SettingsView.tsx` copies the active Node into a local `pickedNode` signal once, when Settings opens.
After that the two are independent:

- Pages that set `followsNodeSwitcher` read `pickedNode` and draw a Node dropdown in their header.
  Those are Installed, Security and backup, Audit log, Schedules, Run history, Telemetry, and Storage
  and memory.
- Every other Node page, and every workspace and project page, reads `activeNodeId()`. The workspace
  and project entries in the Settings rail come from the active Node too.
- The header dropdown never changes `activeNodeId()`. The reference page says so on purpose, because
  changing it remounts the whole shell on the other Node's cache.

So the owner can pick Node B on Installed, move to the next page, and land on Node A with no warning
beyond a chip that changed its text.

## Decisions

- **The selected Node is the only Node a picker offers.** The top bar workspace picker and the
  workspace rail list only the active Node's workspaces, or its projects with workspaces off.
  Changing Node is the Node selector's job alone.
- **Settings shows the selected Node, on every page.** The local `pickedNode` signal goes. The header
  dropdown, where it stays, changes the active Node, the same call the top bar makes. A Node page,
  a workspace page, and a project page then all read the same Node, and the rail's workspaces match.
- **`followsNodeSwitcher` is deleted.** It exists only to tell the two Node sources apart. With one
  source, every Node page reads the active Node, including the ones that pass `context.scope.nodeId`.
  It's internal to client-core (`host/registries/shell/settings.ts`, `corePages.ts`,
  `frames/register.ts`), so no plugin breaks.
- **Settings stays open across a Node switch.** `settingsRequest` is a signal inside `App`, and `App`
  sits under the `<Show when={activeCacheId()} keyed>` in `apps/desktop/src/client/index.tsx`. A
  switch disposes it, which closes Settings. The switch from the Settings header has to carry the
  open page and section across the remount and reopen there. The simplest route is to hold the
  request outside the keyed scope, beside `activeNodeId`, so the new `App` reads it on mount. The
  view itself still remounts, which is what keeps Node A's data off Node B's page.
- **A form with unsaved changes still asks first.** The header dropdown already goes through
  `leave()`. Keep that, because the switch now throws away the whole shell, not only the page.

## Open decision

The command palette's workspace finder (`WorkspacePalette.tsx`, `⌘L`) and its workspace rows
(`routerNavigation.ts`, `openWorkspace`) use the same fleet-wide list and the same switch-then-navigate
step. Narrowing the top bar doesn't have to narrow these.

Recommendation: keep the palette fleet-wide. "Node-aware palette rows" is a documented fleet feature
([features](../features.md#settings-and-fleet)), and the palette is where an owner searches by name
without caring which machine holds it. The rows already name their Node. If James wants the palette
narrowed too, the same filter applies there, and the cross-Node jump goes through **Switch node**
only.

## Changes

1. Give `createFleetWorkspaces` a way to return only the active Node's entries, or add a small
   `activeNodeWorkspaces` beside it that filters `entries` by `activeNodeId()`. Feed that to
   `topbarProps().workspaces` and the workspace rail in `App.tsx`. `pickWorkspace` keeps calling
   `selectFleetWorkspace`, which no longer needs to switch Node from those callers.
2. Drop the ` · <Node label>` row suffix and the rail's per-Node groups, since every row is on one
   Node. Leave `grouped` for the palette if it stays fleet-wide.
3. In `SettingsView.tsx`, delete `pickedNode`, `switchedNode`, and `pageNode`. Every page reads
   `activeNodeId()`. The header chip on a Node, workspace, or project page becomes the dropdown when
   there are two or more Nodes, and its `onChange` calls `leave(() => setActiveNode(value))`.
4. Hold the Settings request outside the keyed scope, so the remounted `App` reopens Settings on the
   same page and section after a switch.
5. Delete `followsNodeSwitcher` from the registry type, `CORE_SETTINGS_PAGES`, and `register.ts`, and
   from their tests.
6. Update [Settings](../frontend/settings.md) § the Node chip, which says the switcher is local and
   never changes `activeNodeId`. Update [Client state and fleet behavior](../architecture/fleet.md)
   and [features](../features.md) wherever they describe the picker as listing every Node.

## Acceptance

Run these with two Nodes paired in `pnpm dev:agent`, each with a workspace named **Default** and at
least one project the other lacks.

- With Node A selected, the workspace picker lists only Node A's workspaces. Switch to Node B, and
  the picker lists only Node B's. The same holds with workspaces off, for projects.
- With the workspace rail shown, it lists only the selected Node's workspaces.
- Open Settings on Installed with Node A selected. Pick Node B in the header. Settings stays open on
  Installed and shows Node B's plugins. Close Settings, and the top bar shows Node B.
- Move from Installed to General and to a workspace page. Every chip names Node B, and the rail's
  workspaces are Node B's.
- With a changed field on a Settings form, picking another Node asks before it switches.
- With one Node paired, nothing about the top bar or Settings changes from today.

Unit tests: `fleetWorkspaces.test.tsx` for the filtered list, `Topbar.test.tsx` for the rows, and
`SettingsView.test.tsx` for the header dropdown calling `setActiveNode` and for every page reading
the active Node.

## Risks and things not checked

- Switching Node from Settings remounts the whole shell under the overlay. On a slow Node that's a
  visible reload behind Settings. Measure it in the walk.
- An owner who used the picker to hop between Nodes loses that shortcut in the top bar. The Node
  selector and the palette's **Switch node** remain.
- The terminal client has its own workspace picker and a **switch node** search group
  (`apps/tui/src/chrome/Shell.tsx`). This plan didn't check whether it mixes Nodes the same way.
  The phone app (`apps/mobile/src/client/Workspaces.tsx`) reads only the active Node already.
