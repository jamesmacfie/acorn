# Phase 6: apps on dashboards

Status: built, 2026-10-20. Depends on [phase 5](./05-project-apps.md). Read
[design.md](./design.md#apps-on-dashboards) first. The shipped behavior is in
[project apps](../../agent-built-apps/project-apps.md#on-a-dashboard) and
[placements](../../dashboards/placements.md#cells-a-plugin-draws), which win where this page disagrees.

## Completion note, October 20, 2026

**What landed.** Two commits, so the codec can ship a release ahead of app cells (requirement 2).

- **The codec**, "Phase 6: Keep panel definitions the codec doesn't know". `parsePanels` keeps a
  definition with no publication when its `view.kind` isn't one of the plan views, exactly as written,
  minus any malformed `publication`. `PanelGridItem` draws it inert, with only the layout items and
  **Remove** in its menu. `panelsToSample` skips anything with no publication, so it no longer counts
  toward the pass cap either. A flat definition from before publications has a plan view, and is
  still dropped.
- **Cells a plugin draws.** `dashboardCellRegistry` in client-core's `features/dashboards/cells.ts`,
  reached through `ctx.contribute` the way project surfaces are. An entry's `id` is the view kind it
  draws. It gives a `component` for the body and optional `menuItems`. The grid keeps the frame, the
  title, gestures, layout items, and **Remove**. The body gets `refreshes`, a count of window focus
  and reported plugin or account changes, and `remove`. The same module has `homeTabsToAddTo` and
  `placeOnHomeTab`, which the panel card uses too.
- **App cells**, in trellis. The definition is
  `{ id: "cell-<appId>", title, view: { kind: "app" }, app: { projectId, appId } }`. `AppCell.tsx`
  checks it, names the project and head, and runs `Revision` at `$placement` `dashboard`, so it shares
  the project app's saved state. A deleted app's cell names it and offers **Restore** and **Remove
  from this dashboard**. The menu adds **Open app** and **Edit in a new task**.
- **Adding.** **Add to dashboard** in the project app's toolbar and in its row's `RowActions`.
  **Publish and add to dashboard** on a card lives in `PublishButton`, so it shares the 409 dialog,
  and places the project app once the publish answers. An unchanged draft just adds its project app.
- **Refreshing.** `createOpenUIRuntime` gained `refresh(tools?)`, which reruns the program's queries,
  all of them or those calling the named tools. At the `dashboard` placement, `AppView` reruns every
  query on each `refreshes` tick and each plan with a `refresh` at that interval, floored at 30
  seconds. `invalidatePublishedPanels` now also matches `dashboard-plan-run`, so an app's `Panel`s
  and a conversation's panel cards follow plugin and account changes.
- The guide says `$placement` can be `dashboard`. The `app` row in `layout.ts` is 4 by 4 at least
  and arrives at 6 by 5.

**Decisions and deviations.**

- **The kind lives in `view.kind`.** The model already promised that a view kind this build doesn't
  know renders inert, and every size lookup reads `view.kind`. A new top-level field would have needed
  a second lookup at each of those call sites.
- **A registry, not a remote extension point.** The grid has to keep the drag handle and the menu, and
  a cell has to add menu items with router access. A remote point's props are JSON and its tree has
  no way into the owner's menu. A compiled-only registry fits, and loaded plugins can't add cells.
- **Core draws no Add to dashboard component.** `plugin-api/client` may only re-export plain modules,
  so core exports the tab list and the placing, and each caller draws its own menu items. The
  terminal's `ui/dashboards` stand-ins offer no tabs, so trellis hides **Add to dashboard** there. The
  terminal doesn't load the dashboards preference, so placing from it would have claimed success and
  saved nothing.
- **Edit is Edit in a new task.** Home has no task of the app's project to edit in, so the menu item
  says what it does. It shares `useAppEditing` with the Apps source.
- **Restore is on the cell.** The Apps source shows only while its project has a live app, so after
  deleting the only one, its **Archived apps** list can't be reached. The cell restores through the
  same route.
- **One definition per app.** Adding the app to a second tab places the same definition, so every
  tab shows the same app and state, as requirement 7 and the out-of-scope note expect.
- **Focus refreshes every time.** A panel refetches on focus only when its data is more than 30
  seconds old. An app cell reruns its queries on every focus.
- client-core's entrypoint cap rose from 200 to 201 for `cells.ts`.
- Sizes: the Node service graph is 1,896,739 bytes, 34 more than phase 5. The desktop renderer's
  compiled roster is 334,328 bytes of 340,000, 2,048 more. The terminal startup closure is 757,059 of
  770,000, 132 more.

**Verify-before-building answers.** The client (`parseDashboards` in `persist.ts`) and the Node's
sampler (`panelsToSample`, `definedPanelIds`) both read through `parsePanels`, so one change covered
both. No other code reads or rewrites the `dashboards` preference, and the terminal client doesn't
load it. `normalize` takes each placed panel's minimums from `sizeFor(view.kind)`, so an app cell gets
the `app` row and an unknown kind falls back to the list row.

**Checks run.** Unit tests: `persist.test.ts`, `PanelGridItem.test.tsx`, `dashboardClient.test.ts`,
`sampler.test.ts`, the runtime's refresh in `Renderer.test.tsx`, and in trellis `AppCell.test.tsx` and
`PublishButton.test.tsx`. Also the plugin API surface snapshot (regenerated), the architecture rules,
the full `pnpm lint`, and the full `pnpm test`. In the full run, `plugin-examples` hit the known
`pnpm pack` race, and passed when rerun alone. Every other package passed. Live, in a `pnpm dev:agent` window with a managed Claude
Code session (Opus 5.5, Auto mode) on a project-folder task, with `document.hidden` faked:

- Checkpoint 1: passed. A definition with `view.kind` `later-kind` and an extra nested field, written
  into the preference, drew inert with only the layout items and **Remove**. **Move up** saved the
  preference, and the definition came back as written, with `shaping: {}` added.
- Checkpoint 2: passed. The ticked item showed in the app's page in the Apps source. With the window
  hidden, a task created through the Node didn't appear. On focus the app reran its query and listed
  it, and the panel beside it refetched.
- Checkpoint 3: passed. After **Delete**, the cell said "My task checklist isn't available. It was
  deleted from acorn." **Restore**, through the route and through the cell's button, drew the app
  again with its ticks.
- Checkpoint 4: passed. Asked for "a checklist of my tasks … each with a tick box, and a count", the
  agent built it. **Publish and add to dashboard** > **Home** made the project app, put it on Home
  sized 6 by 5, and **Apps** appeared in the rail.

The test window showed one trap. A hidden `dev:agent` window never runs CSS transitions, so a cell
placed before the grid measured itself stays drawn at the starting 44-pixel cells. The stored rect was
right. Turning transitions off in a page script showed the real size. The terminal client wasn't run
live, for phase 3's reason. Its stand-ins are type-checked and its trellis test passes.

**For later phases.**

- The site's Apps and Dashboards pages gained a section and a pointer for app cells. They need
  `pnpm --filter @acorn/site stale --mark` after the commit.
- A cell can't be a loaded plugin's. If one needs to be, the cell registry needs a remote twin with
  owner actions for **Remove** and a declared menu.
- An app cell takes its title from the app's name when it was added. Nothing renames apps yet, but a
  rename would leave old cells under the old name.
- `invalidatePublishedPanels` keeps its name, though it also covers unpublished plan runs.

## Goal

A project app sits on a Home tab beside ordinary panels and refreshes the way they do. From an app
card in the conversation, one click publishes the app and puts it on a dashboard.

## What the owner gets at the end

- **Add to dashboard** on a project app, in its pane and its rail row, which asks for a Home tab.
- **Publish and add to dashboard** on a task app's card, which publishes it to the project first.
- An app cell on Home that draws the app's head, refreshes its plans like any panel, and keeps the
  project app's state.
- A cell for a deleted app that says so and offers **Remove from this dashboard**, instead of a hole.

## Starting point

- Phase 5's project apps, their pane, and their state.
- Home tabs, the grid, and the panel menu ([placements](../../dashboards/placements.md)).
- The `dashboards` preference and its shared codec, `packages/dashboards-core/src/definition.ts`,
  which the client and the Node's measure sampler both call ([dashboards](../../dashboards.md#persistence)).

## Requirements

### The codec comes first

1. The shared codec keeps a panel definition of a kind it doesn't recognize, and the grid draws it
   inert, instead of dropping it. Today the codec drops a definition with no publication, so an older
   client that saves the preference would delete every app cell.
2. The codec change ships in a release before app cells do.

### App cells

3. An app cell's definition names the project and the app, and has no publication. It always runs the
   app's head.
4. An app goes only on Home tabs of the workspace that holds its project. The cell names the project.
5. The cell draws the app with `$placement` set to `dashboard`. Its smallest size is a card's.
6. The app's plans refresh on the dashboard's rules: when the window regains focus, after a reported
   account or plugin change, and at each plan's refresh interval.
7. The cell uses the project app's state, shared with its pane.
8. The panel menu offers **Open app**, **Edit**, and **Remove from this dashboard**. Rename, view, and
   sort don't apply to an app cell.
9. A deleted app's cell shows an unavailable state that names it. **Restore** on the app brings the
   cell back.
10. The Node's measure sampler skips app cells, because they have no stat measures of their own.

### Adding

11. **Add to dashboard** on a project app asks for a Home tab and places the app there, under the
    owner's device.
12. **Publish and add to dashboard** on a task app's card publishes the app to the project, then adds
    it the same way.

## Out of scope

- App cells in plugin regions. A region constrains panels by source, field role, and view, from
  publication metadata an app cell doesn't have. See [the open questions](./README.md#open-questions).
- App cells in the terminal client, which draws no dashboard panels.
- Several placements of one app with different state. State belongs to the app.

## Steps and checkpoints

### 1. The codec

**Checkpoint 1.** A `dashboards` preference holding a definition of an unknown kind round-trips through
parse and save in a client without app cells. The definition survives, and the grid draws it inert.

### 2. App cells

**Checkpoint 2.** Add a project app to a Home tab beside an ordinary panel. Tick an item in the app.
Open the app's pane, and the tick is there. Switch away and back to the window, and both the panel and
the app's plans run again.

**Checkpoint 3.** Delete the app. The cell names it and offers **Remove from this dashboard**. Restore
the app, and the cell draws it again.

### 3. From the conversation

**Checkpoint 4.** In a chat, build a task app and choose **Publish and add to dashboard** on its card.
It appears on the chosen Home tab and in the project's **Apps** rail source.

## Docs that change

- [Dashboards](../../dashboards.md): app cells, and the codec's rule for unknown definitions.
- [Placements](../../dashboards/placements.md): adding an app to a Home tab, and the panel menu for an
  app cell.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- That the client and the Node's measure sampler both parse definitions through `parsePanels`, so one
  codec change covers both.
- Whether any other reader of the `dashboards` preference rewrites it, and so would drop app cells.
- How the grid's per-view-kind minimum sizes in `normalize` would take an app cell's size.
