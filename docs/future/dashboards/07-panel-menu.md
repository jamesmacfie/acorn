# Phase 7: quick edits from the panel menu

Status: proposed, October 5, 2026. Depends on [phase 2](./02-plan-outline-model.md) for
**About this panel**, and on [phase 3](./03-studio-shell.md) for **Edit…** and **Edit with AI…**.
**Rename**, **View as**, **Sort by**, and **Duplicate** depend on nothing and can ship first. Read
the [programme README](./README.md) first. The
[Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) shows the menu in
"Editing a placed panel".

## Goal

Most edits after the first publish are small. Let people make them from the panel's own menu
without opening the studio. Let anyone read what a panel does without opening an editor. Give the
drill-down's **Add as panel** a path into the studio.

## Starting point

- The panel menu is in `packages/client-core/src/features/dashboards/PanelGridItem.tsx`. It has
  **Edit**, **Move or resize**, **Move up**, **Move down**, **Move to** a tab, **Remove from this
  dashboard**, and **Delete panel**. `PanelGrid.tsx` supplies the `actions` object.
- A placed panel has two records. The plan lives on the Node as a draft
  (`dashboard_drafts`) plus immutable published revisions (`dashboard_revisions`). The client keeps a
  `PanelDefinition` in the `dashboards` preference (`persist.ts`) with the title, the view, and
  `publication: { dashboardId, sources, fieldRoles }`.
- Publishing has one implementation, `publish()` in `DashboardEditor.tsx`. It flushes the draft,
  describes each source to derive `sources` and `fieldRoles`, calls `client.publish`, invalidates
  the panel's queries, discards the device recovery copy, and calls `onPublished`. The host,
  `DashboardPanelHost.tsx`, then calls `savePanel` and, on first publish only, `placePanelAt`.
- `addDrilldownPanel` in `PublishedDashboardPanel.tsx` creates and publishes a derived plan
  directly, then saves and places it. It copies `sources` and `fieldRoles` from the parent panel
  rather than deriving them.
- `DashboardDraft` (`packages/protocol/src/dashboards/panels.ts`) has `draftRevision`,
  `basePublishedRevision`, and `publishedRevision`. The client's `published(id)` returns the live
  revision's content.

## Requirements

### One publish path

1. Use `publishPanelPlan` from `panelPublish.ts`, which [phase 3](./03-studio-shell.md) extracts
   from the editor. If phase 3 hasn't landed, do that extraction here. The studio, the quick edits
   below, and `addDrilldownPanel` all call it. That also fixes the drill-down copying its parent's
   `sources` and `fieldRoles`, which can be wrong once the derived plan has a summary.
2. Add `hasUnpublishedEdits(draft, published)`, which compares the draft content's JSON with the
   published revision's content. Quick edits use it in requirement 4.

### Quick edits

3. Add three items above **Move or resize**, after **Edit…** and **Edit with AI…**:
   - **Rename** makes the panel title editable in place in the panel header. Enter saves and Escape
     cancels.
   - **View as** opens a `Menu` of the views from `availableViews(plan)` (phase 2). An unavailable
     view is disabled and shows its reason as the item's description.
   - **Sort by** opens a `Menu` of the plan's output columns, with the current sort ticked and a
     direction toggle at the bottom.
4. A quick edit loads the draft. If `hasUnpublishedEdits` is true, it changes nothing and shows "This
   panel has unpublished edits. Open it to finish or discard them." with an **Open** button.
   Otherwise it saves the one change to the draft and calls `publishPanelPlan`. Changing a view
   also sets the view's default options the same way the editor's view `Select` does.
5. The menu's `Kbd` hints: **Edit…** shows the platform's Enter. No others.

### Edit entries

6. Rename **Edit** to **Edit…**, because it opens a surface. It opens the studio on that panel, as
   in phase 3.
7. Add **Edit with AI…**, which opens the studio with the AI dock open and the composer focused.
   Before phase 6, it opens the studio with the AI modal instead.

### About this panel

8. Add **About this panel** after a separator. It opens a read-only side panel (the kit `Drawer`)
   showing:
   - The outline from `planOutline(plan, sources)`, using the last run's `PlanSource` data so
     accounts and reach show their real labels. Rows aren't selectable.
   - The original request (`plan.request`) when there is one, under "Asked for".
   - The requirements list, when there is one, with each item's status and reason.
   - The published revision number and when it was published.
   - An **Edit…** button.

### Duplicate

9. Add **Duplicate**. It creates a new draft from the published content with the title
   "*title* copy", publishes it, saves a `PanelDefinition`, and places it next to the original on
   the same tab with the original's size. It doesn't open the studio. A toast says "Duplicated" with
   an **Edit…** action.

### Add as panel

10. After `addDrilldownPanel` succeeds, the outcome text "Panel added." becomes a toast with an
    **Edit…** action that opens the studio on the new panel.

### Final menu order

11. The menu reads, top to bottom:

    ```text
    Edit…
    Edit with AI…
    Rename
    View as          ▸
    Sort by          ▸
    ─────────────
    About this panel
    Duplicate
    ─────────────
    Move or resize
    Move up
    Move down
    Move to …        (when other tabs exist)
    ─────────────
    Remove from this dashboard
    Delete panel
    ```

## Out of scope

- Quick edits for anything else, such as filters. Those belong in the studio, where the preview
  shows their effect.
- Undo for quick edits. Each one is a published revision, and **Edit…** can change it back.

## Tests

- `panelPublish.test.ts`: the drill-down path derives its own `sources` and `fieldRoles`.
- `hasUnpublishedEdits` for identical content, changed content, and a draft never published.
- A `PanelGridItem.test.tsx` under the client-core `hosts` project: the menu order, **View as**
  disabling a view with its reason, and the unpublished-edits refusal.

## Check it in the app

Publish a panel, then use **Rename**, **View as**, and **Sort by** from its menu, and check that each
change survives a reload. Open the panel in the studio, change a filter without publishing, close
the studio, and check that **Rename** refuses with the unpublished-edits message.

## Docs to update

- `docs/dashboards/placements.md`: the panel menu's items.
- `docs/dashboards.md` § Published panels: quick edits publish a revision, and **About this panel**.

## Verify before building

- Whether `Menu` supports a nested menu for **View as** and **Sort by**. The comment in `PanelGrid.tsx`
  says `Menu` has no submenu, and **Move to** is drawn as a flat labelled group for that reason. If
  that still holds, draw **View as** and **Sort by** the same way, as labelled groups.
- That the kit `Drawer` can host the outline without a new kit node.
- That the toast host accepts an action button.
