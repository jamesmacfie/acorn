# Phase 1: check that dynamic UI fits

## Completion note

Built on October 20, 2026, on branch `phase-1-dynamic-ui-fit`.

What landed:

- Plugin regions are keyed by workspace, `plugin-region/<pluginId>:<id>/<workspaceId>`.
  `regionScope(ownerId, workspaceId)` builds the key. The rail source's side panel and the pane aside
  both pass the routed workspace from `createActiveWorkspaceId`.
- Adoption is one function, `adoptUnscoped(state, scope)` in `persist.ts`. It moves one scope's
  unscoped board and its geometry to the workspace, and never overwrites a key that has a board.
  `adoptUnscopedHome` calls it for each unscoped tab, then stamps the tab names, so Home's keys,
  behavior, and tests are unchanged. `PanelGrid` adopts a region's unscoped board when it draws one.
- `panelRegionRegistry` in `region.ts` lists every region. The chrome pass registers each rail source
  that declares `panels`, and the frame pass registers each `pane.aside`, both gated on the plugin
  being on for the node. `regionsToAddTo` answers which regions of a workspace would show a panel,
  and whether each is full.
- A panel card's **Add to dashboard** lists the Home tabs, a separator, then those regions under
  their source or pane label. Opening the menu describes the plan's sources once, and only when a
  region is on. A refusing region is left out, a full one is disabled, and choosing one places the
  panel through `addNewPanel` with the region passed, so publish checks it again. **Edit…** in the
  toast opens the studio with the region.
- Docs: [placements](../../dashboards/placements.md) for keys, adoption, the registry, and the card's
  region rules; [dashboards](../../dashboards.md) for **Add to dashboard**; and the open question in
  [dynamic UI's README](../dynamic-ui/README.md) is answered.

The five checks:

1. Starters in an empty region hold. `PanelGrid` hands its region to `DashboardPanelHost`, which hands
   it to `PanelLauncher`. Before this phase the launcher got an empty workspace ID in a region, because
   the region scope had none. It now gets the routed workspace.
2. Added views reach cards and apps. A panel card and an app's `Panel` both draw through
   `PublishedDashboardPanel`. Trellis's `Panel` schema takes a plan name and lists no view kinds.
3. The agent learns added views. `panel_guide` embeds `PANEL_CAPABILITIES`, and the app guide embeds
   `panel_guide`'s output. Phase 4 adds the view to `dashboardViewKinds` and to
   `PANEL_CAPABILITIES.views`. Two prose lines also name the five views and need the new one:
   `choosingAView` in `panelGuide.ts`, and the `Panel` description in trellis's `shared/library.ts`.
4. Run budget holds: `DATA_LIMITS.selectionRecords` is 5,000. Nothing changed.
5. A region's `sources` accepts any `<pluginId>:<sourceId>`. Neither the manifest parser nor the Node's
   manifest checks tie it to the declaring plugin, and the launcher offers another plugin's source.

Deviations:

- A full region shows disabled with no reason text. **Duplicate** shows none either, so "the same
  reason **Duplicate** gives" is no text.
- After adding to a region, the card names the region but offers **Open** only for a Home tab.
  Opening a region would need the source or pane to navigate to, which the registry doesn't carry.

Checked in `pnpm dev:agent`: a throwaway plugin with a rail source whose region allows
`agents:sessions`, and a seeded `panel_show` card in a task. The card's menu listed **Home** and
**Session board**. Choosing **Session board** stored the panel under the workspace's region key, and
the region drew it. The region's **Add panel** opened the launcher with only the agents source.

For later phases: phase 8's region can list `agents:*` sources directly. No shipped plugin declares a
region yet, so phase 8's will be the first.

Date: October 19, 2026. Status: proposed. Needs the [dynamic UI](../dynamic-ui/README.md)
programme merged.

## Goal

Every analytics panel this programme ships is an ordinary dashboard panel, drawn on Home, in a
plugin region, in a panel card, or inside an app. This phase checks that dynamic UI gives those panels
what they need, and makes three small changes where it doesn't. Nothing it changes may alter how Home,
panel cards, or apps behave today.

## Starting point

- Home boards are keyed by workspace. A Home tab is the scope `home/<tabId>/<workspaceId>`, and the
  first workspace to open an unscoped board adopts it (`adoptUnscopedHome` in
  `packages/client-core/src/features/dashboards/persist.ts`).
- A plugin region is keyed `plugin-region/<pluginId>:<regionId>` with no workspace. The comment on
  `PlacementScope` says a region is "already pinned to the surface it hangs off". A rail source's
  side panel is the same source in every workspace, and a panel's plan names one workspace, so a
  panel placed in workspace A draws A's rows when you open the source in workspace B.
- `regionScope` in `packages/client-core/src/features/dashboards/region.ts` builds the key, and
  `regionRefusal` says why a region won't show a panel.
- The panel launcher already limits its sources to a region's sources and offers their starter
  plans (`regionAllowsSource` and `checkedStarters` in
  `packages/client-core/src/features/dashboards/studio/PanelLauncher.tsx`).
- On the `dynamic-ui` branch, a panel card's **Add to dashboard** lists the Home tabs of the task's
  workspace and publishes through `addNewPanel` in `panelPublish.ts`. Dynamic UI's README leaves
  "Where Add to dashboard can put things" open, with plugin regions named as a later option.
- On the same branch, an app's `Panel` draws a plan with the dashboard views in
  `packages/client-core/src/features/dashboards/views/`, and `panel_guide` returns the instructions
  in `panelGuide.ts`, which read the view and bucket vocabulary from
  `packages/dashboards-core/src/capabilities.ts`.

## The design

### Key plugin regions by workspace

Give `plugin-region` placements the same third segment Home has. `regionScope(ownerId, workspaceId)`
returns `{ surface: 'plugin-region', ownerId, workspaceId }`, and every caller passes the routed
workspace. With no workspace known, the key stays bare, as Home's does.

Placements stored before this change keep working. A region's unscoped placement is adopted by the first workspace that
draws the region, through the same rule as `adoptUnscopedHome`. Generalize that function to take a
scope instead of copying it. Adoption copies the placement and its layout to the workspace's key and
never overwrites a key that already has panels.

This applies to both kinds of region, a rail source's side panel and a pane's aside, because both hold
panels whose plans name a workspace.

### Let Add to dashboard reach plugin regions

A panel card's **Add to dashboard** lists the plugin regions of the task's workspace after its Home
tabs, under each region's source or pane label. A region that would refuse the plan is left out, using
`regionRefusal` with the plan's sources and view. A region at its panel limit shows disabled, with the
same reason **Duplicate** gives. Choosing one publishes and places the panel through `addNewPanel`,
with the region's scope.

App cells stay out. Regions check a panel's sources and view, and don't understand an app's plans.

### Confirm the rest

Check these and change nothing if they hold:

1. **Starters in an empty region.** An empty region's add button opens the launcher with the region's
   sources and their starter plans, one press per starter. If it opens the studio without starters,
   pass the region to the launcher as the studio already does.
2. **Added views reach cards and apps.** A view kind added in [phase 4](./04-heatmaps-and-stacked-bars.md)
   draws in a panel card and in an app's `Panel` with no change to the app library. If the library's
   `Panel` schema lists view kinds, make it read `dashboardViewKinds` instead.
3. **The agent learns added views.** `panel_guide` and the app guide read their view and bucket lists
   from `capabilities.ts`, not from a copy, so phase 4 reaches them through that one file.
4. **Run budget.** The run route keeps the 5,000-record host budget for every source. Phase 3 sizes its
   sources under it, so nothing here changes.
5. **Another plugin's sources in a region.** A region's `panels.sources` can name another plugin's
   source, such as `agents:turns`, and the launcher offers it. [Phase 8](./08-analytics-plugin.md)'s
   region lists its own source and three of the agents plugin's. If the manifest parser accepts only
   the declaring plugin's sources, allow any registered source, because a region's constraint limits
   what draws there and grants no read.

## Steps

1. Add the workspace segment to `regionScope`, generalize adoption, and pass the routed workspace from
   the rail source panel and the pane aside.
2. List accepting regions in **Add to dashboard**.
3. Run the four checks, and fix any that fail as described.
4. Update [placements](../../dashboards/placements.md) for region keys and adoption, and
   [dashboards](../../dashboards.md) for where **Add to dashboard** can place a panel. Answer the open
   question in dynamic UI's README.

## Acceptance

- A test places a panel in a rail source's region in workspace A. Opening the same source in workspace
  B shows an empty region, and A still has its panel.
- A test starts from a stored unscoped region placement. The first workspace that draws it adopts it,
  and a second workspace starts empty.
- Home's keys, adoption, and tests are unchanged.
- In `pnpm dev:agent`, a panel card in a task offers a plugin region of the task's workspace, and
  choosing it places the panel there.
