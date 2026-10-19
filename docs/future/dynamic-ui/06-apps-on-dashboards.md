# Phase 6: apps on dashboards

Status: proposed, 2026-10-19. Depends on [phase 5](./05-project-apps.md). Read
[design.md](./design.md#apps-on-dashboards) first.

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
