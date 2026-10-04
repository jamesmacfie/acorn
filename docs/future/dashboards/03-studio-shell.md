# Phase 3: the studio shell

Status: shipped, October 5, 2026, in commit `326ae2813`. [What shipped](#what-shipped) records the
choices made while building it and what it left for later phases. Depends on
[phase 2](./02-plan-outline-model.md). Read the [programme README](./README.md) first, especially
[the decisions](./README.md#decisions-already-made). The
[Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) shows the target in "The
studio".

## Goal

Replace the `Modal` with a full-window studio. The studio has a toolbar, an outline of the plan, the
live panel, an inspector for the selected part, and a status bar, with undo and redo and a publish
review. This phase moves the existing forms into the inspector unchanged.
[Phase 4](./04-inspectors.md) rewrites them. At the end of this phase, `DashboardEditor.tsx` is
gone.

## Starting point

- `DashboardEditor.tsx` holds the whole editor: the plan signal, autosave, the preview query, the
  AI fold, every form, and publish. `DashboardPanelHost.tsx` renders it and turns a publication into
  a `PanelDefinition` and a first placement.
- `PanelGrid.tsx` opens the editor through a `typedEditing` signal: `{}` for **Add panel** and
  `{ dashboardId }` for **Edit**. `Home.tsx` mounts its own `DashboardPanelHost` for its header
  **Add panel**.
- The editor is opened from three hosts. Each passes a `PlacementScope` (`persist.ts`):

  | Host | File | Scope | What's on screen behind it |
  | --- | --- | --- | --- |
  | Home | `packages/client-core/src/features/workspaces/Home.tsx` | `homeTabScope(tab, workspaceId)` | The Home rail source |
  | Plugin region | `packages/client-core/src/host/chrome/ChromeSourcePanel.tsx` | `regionScope(pluginId:sourceId)` plus `region` | A plugin's rail source, list and detail |
  | Task pane aside | `packages/client-core/src/host/chrome/ChromeExtendedPane.tsx` | `regionScope(pointId)` plus `region` | A task, with its panes, plugin frames, and terminal drawer |

- The plugin hosts pass a `PanelRegion` (`region.ts`) to `PanelGrid`, with allowed `sources`, a
  required `fieldRole`, allowed `views`, and a `max`. The editor never receives it, so it lets you
  build a panel the region then refuses to show (`regionAllows`).
- Settings is the model for a full-window layer. `packages/client-core/src/features/settings/SettingsView.tsx`
  renders in a `Portal` from `apps/desktop/src/client/App.tsx`. It is `role="dialog" aria-modal`,
  and `settings.css` gives it `position: fixed; inset: 0; z-index: var(--z-modal)`. Its comment says
  why it isn't a route: "A route would unmount the task's panes." Task keybindings stand down while
  it's open, through `taskActive={inTaskView() && !settingsRequest()}` in `App.tsx`.
- The Workflows editor (`plugins/workflows/src/client/editor/WorkflowEditor.tsx`) is the layout to
  copy. It uses the kit `Toolbar`, `ToolbarSpacer`, `Tabs`, `ListDetail`, `ListColumn`,
  `DetailColumn`, `Rows`, `Row`, `SectionHeader`, `Menu`, and `Modal`. Its undo and redo live in
  `plugins/workflows/src/client/editor/draftStore.ts`: whole-draft snapshots in `past` and `future`
  stacks, typing coalesced within 600 ms, and a depth of 60 (`pushUndo` in `editor/draft.ts`).
  Its status bar is a `Toolbar size="sm"` that links the first problem to its step. Its **Publish…**
  opens a `Modal size="md"` review.

## Requirements

### The layer

1. Add `PanelStudio.tsx` in a `studio/` folder inside the dashboards feature folder. Render it from
   `DashboardPanelHost` in a `Portal`, as a full-window layer styled like `.settings-view`. It is
   `role="dialog"`, `aria-modal="true"`, and labelled by its title. Put layout CSS on the studio's
   own wrapper elements in `dashboards.css`, never on kit nodes. The closed-kit rule in
   `docs/ui-design/closed-kit.md` forbids `class` on kit components.
2. **Escape** closes the studio when no menu, popover, or modal inside it is open. Work is autosaved,
   so closing never loses edits. Focus returns to the control that opened it.
3. Stand down task keybindings while the studio is open, the same way Settings does. Expose an
   `isPanelStudioOpen()` signal from the dashboards feature and add it to the `taskActive` expression
   in `App.tsx`. Check whether the terminal drawer needs the same treatment.
4. `DashboardPanelHost` gains a `region?: PanelRegion` prop. `PanelGrid` passes its `region`, and
   the studio receives it. Home passes none.

### State

5. Add `studioStore.ts` beside the studio. It owns the plan, the selected `PlanPartKey`, undo and
   redo, the draft, the save state, and autosave. Move the autosave and recovery logic from
   `DashboardEditor.tsx` here unchanged: a device recovery copy on every change, a Node save
   after 750 ms when the plan parses, and the same "Saved", "Saving…", "Saved on this computer",
   and "Couldn't save" states.
6. Copy the Workflows undo model: `apply(change, { coalesce })` pushes a whole-plan snapshot and
   clears `future`; text edits within 600 ms coalesce into one step; `select()` changes the
   selection without an undo step; the stack holds 60 entries. Don't import from the workflows
   plugin. If you find yourself copying more than the stack helpers, move them into a shared module
   in client-core and have both use it.
7. Bind **Undo** and **Redo** to the toolbar buttons and to ⌘Z and ⇧⌘Z (Ctrl on other platforms)
   while focus is in the studio but not in a text field.

### Layout

8. The studio is a column: toolbar, tabs, body, status bar.
9. **Toolbar**, left to right:
   - A back button labelled with where you came from: the Home tab's name, the plugin source's
     name, or the task's title. It closes the studio.
   - The panel title as a `Heading` level 2. Clicking it edits it in place. Enter commits and
     Escape cancels.
   - The save-state `Badge`.
   - A **Published** or **Not published** `Badge`. When the draft differs from the published
     revision, it reads **Unpublished changes**.
   - `ToolbarSpacer`.
   - **Ask AI**, **Undo**, **Redo**, **Publish…** (`variant="solid"`), and an overflow `Menu` with
     **Discard changes** (when published) and **Delete panel** (`tone="danger"` with a confirm).
     **Keep history** stays in the source's inspector, because it acts on one source's query.
10. **Tabs**: **Outline** and **Plan**. **Plan** shows the plan as read-only, formatted JSON with a
    copy button, like Workflows' **Code** tab but not editable.
11. **Body** on the **Outline** tab: a `ListDetail split` with the outline in the `ListColumn`. The
    `DetailColumn` holds a studio-owned wrapper with two areas: the preview, and a 320-pixel
    inspector on the right. Below 1,100 pixels of window width, the inspector stacks under the
    preview.
12. **Status bar**: a `Toolbar size="sm"`. It shows the first problem as a `Link` that selects its
    part, plus "and *N* more". With no problems it shows "*N* steps · *M* columns · no problems".
    When the plan has a published revision and differs from it, it adds a summary from
    `diffOutline(published, draft)`, such as "Unpublished: 1 step added, 1 column changed".

### The outline

13. Draw the outline from `planOutline(plan, sources)` with the kit `Rows`, `Row`, and
    `SectionHeader`, as `NodeList` does in Workflows. Section headers are **Data**, **Columns**,
    **Steps**, **Arrange**, **Look**, and **Settings**. **Look** holds the look and behaviour parts.
14. Each row shows the part's icon, title, and detail. Its trailing slot shows the count from
    `countsByPart`: "312" for a source, "312 → 41" for a step. A part with problems from
    `problemsByPart` shows a warning glyph and a warning tone on its count, and its problem text as
    the row's tooltip.
15. Selecting a row sets the store's selection and opens that part in the inspector. Arrow keys move
    the selection, as in any `Rows` list.
16. A **+ Add** button in the outline header opens a `Menu` with **Source**, **Column**, and one item
    per entry from `availableOperations(plan)`. An unavailable operation is disabled and shows its
    reason as the item's `title`. Adding a part selects it.
17. A row's context menu (`onMenu`) offers **Move up**, **Move down** for steps, **Remove**, and
    **Ask AI about this** (phase 6 makes that last one useful; until then it opens the AI modal with
    the part named in the prompt).

### The preview

18. The preview is `PanelBody` from `views/PanelBody.tsx`, drawn from the draft run, inside the same
    `Card` chrome a placed panel uses. Move the run query from `DashboardEditor.tsx` unchanged: a
    TanStack query keyed on the plan's JSON that calls `client.run({ kind: 'draft', content },
    'preview', zone)`.
19. Above the preview, a `SegmentedControl` picks **S**, **M**, or **L**, from
    `sizePresets(view.kind)` in `packages/dashboards-core/src/layout.ts`. The preview's width is
    `rect.w / COLS` of the preview area, and its height follows from the same cell pitch. When
    editing a placed panel, start on the size closest to its placed rectangle. Label the control
    "Size on the dashboard".
20. Beside the size control: "*N* rows · read *relative time*", from `diagnostics.evaluationTime`,
    and a refresh `IconButton` that refetches.
21. Make the preview select parts. Add an optional `onSelectPart?(key: PlanPartKey)` to `PanelBody`
    and pass it through to the views. In this phase, wire three things: a `TableView` column header
    selects `column:<id>`, a group header in any view selects `arrange`, and the panel title selects
    the toolbar title for editing. Placed panels don't pass the prop, so they don't change.
22. With no source yet, the preview area shows the two entrances from today's editor, **Pick data**
    and **Describe it**, as an `EmptyState`. [Phase 5](./05-launcher.md) replaces them with the
    launcher.

### The inspector

23. The inspector shows the selected part's form, with the part's title as its heading. Add
    `inspectors.tsx` with a map from part kind to component. In this phase each entry wraps the form
    that already exists, moved out of `DashboardEditor.tsx` without behaviour changes:

    | Part | Form moved in |
    | --- | --- |
    | `source:<id>` | `SourceQueryEditor` with `hideAuthoring`, `pickSourceAccount`, `hideConditions`, `hidePreview`, the row role, starter plans, **Keep history**, and **Remove source** |
    | `relations` | `EquivalenceForm`, the relation cards, and the declared-relation buttons |
    | `columns` | The column cards |
    | `stage:<n>` | The filter fields, or `CompositionStageForm` |
    | `arrange` | Sort, group, and limit |
    | `look` | Title, view, and the view's options |
    | `behaviour` | **When a row is pressed** and **Row buttons** |
    | `settings` | Refresh and the time policy |

24. With nothing selected, the inspector shows the plan's request (`plan.request`) if there is one,
    and a hint: "Select a part of the panel to change it."

### AI

25. **Ask AI** opens `AuthoringConversation` in a `Modal size="lg"`, passing `onClose`, as Workflows
    does. Keep `applyAiProposal` and its merge and validation unchanged, but apply the candidate
    through the store as one undoable step, which replaces the single-level **Undo AI edit**.
    [Phase 6](./06-docked-ai.md) docks the conversation.

### Publish

26. Move publishing into `publishPanelPlan` in a module named `panelPublish.ts` in the dashboards
    feature folder. Phase 7 reuses it. It flushes the draft, derives `sources` and `fieldRoles` by
    describing each source, publishes, invalidates the panel queries, and discards the recovery
    copy. `DashboardPanelHost` keeps saving the `PanelDefinition` and the first placement.
27. **Publish…** opens a `Modal size="md"` review, like Workflows' **Publish workflow**. It lists:
    - What changes, from `diffOutline(published, draft)`, as outline rows marked added, changed,
      or removed. For a first publish it says "New panel".
    - Where it goes. On Home, for a new panel, a `Select` of Home tabs. This replaces the
      **Dashboard** select at the bottom of today's form. Elsewhere, the region's name, read-only.
    - Problems that block publishing: schema failures, run errors, and region violations.
28. Check the region before publishing. If the region declares `views`, `sources`, or a
    `fieldRole`, apply the same test as `regionAllows` to the derived metadata. On failure, block
    with a reason, such as "This area only shows Board and List panels."
29. Keep the requirements gate from today (every requirement confirmed) until phase 6 replaces it.
    Show the checklist in the review modal, not the preview.

### Removal

30. Delete `DashboardEditor.tsx` and the `.dash-v2-editor` and `.dash-v2-preview` rules in
    `dashboards.css`. Move any test that renders it to the studio.

## Out of scope

- New form designs. That's phase 4.
- A route for the studio. See [the decisions](./README.md#decisions-already-made).
- Previewing rows after one step. See [refused](./refused.md).

## Tests

- `studioStore.test.ts` (logic tier): apply, coalesce, undo, redo, depth cap, selection without an
  undo step, and autosave timing with fake timers.
- `PanelStudio.test.tsx` (`hosts` tier, jsdom): renders with a stubbed client; selecting an outline
  row shows its inspector; a problem on `/stages/0` marks the step row; **+ Add** disables an
  unavailable operation with its reason; Escape calls `onClose`.
- `panelPublish.test.ts`: derived `sources` and `fieldRoles`, and a region violation refusing to
  publish.

## Check it in the app

Follow [the README's steps](./README.md#check-it-in-the-app). Open **Add panel** on Home, pick
**Workspace tasks**, add a filter step, undo it, redo it, and publish. Then open a task with a pane
aside, if your session has a plugin that declares one, and check that the studio opens over the task
and closing it leaves the task's panes and terminal as they were.

## Docs to update

- `docs/dashboards/mapping-and-editor.md` § The generated editor: rewrite the editor paragraphs for
  the studio. Keep the heading, because `layout.ts` cites it.
- `docs/ui-design/overlays.md`: add the panel studio beside Settings as a full-window layer.
- `docs/dashboards/placements.md`: region constraints are checked at publish.

## Verify before building

- `taskActive` in `App.tsx` is still where task keybindings stand down, and Settings still uses it.
- Whether `ListDetail` accepts a detail column that contains a two-area layout without fighting its
  own scroll. If not, use a nested `ListDetail` for preview and inspector.
- `PanelBody`'s props and every view under `views/`, so the optional `onSelectPart` reaches
  `TableView` and the group headers.
- That no plugin imports `DashboardEditor`. It is in client-core, not in `@acorn/plugin-api`.

## What shipped

All 30 requirements shipped, with the tests listed above. `docs/dashboards/mapping-and-editor.md`
§ The generated editor describes the shipped behaviour and wins over this page.

Where the code lives, in `packages/client-core/src/features/dashboards/`:

- `studio/PanelStudio.tsx` is the layer, toolbar, tabs, status bar, AI dialog, and publish review.
  `studio/StudioOutline.tsx` draws the outline and `studio/StudioPreview.tsx` the preview.
- `studio/inspectors.tsx` holds `INSPECTORS`, one form per part kind, and the plan edits the
  outline's **Add** menu and row menu share (`addColumnTo`, `addStageTo`, `moveStageIn`, and others).
- `studio/studioStore.ts` owns the plan, selection, undo, redo, and autosave.
- `studio/studioOpen.ts` holds `isPanelStudioOpen`. It's a module of its own, with an entry in the
  client-core `exports` map, so `App.tsx` doesn't load the studio to read one flag. That raised
  client-core's entrypoint cap in `tools/arch/boundaries.test.ts` from 167 to 168.
- `panelPublish.ts` holds `publishPanelPlan` and `describePanelSources`. `region.ts` gains
  `regionRefusal`, which returns the reason, and `regionAllows` calls it.

Choices made while building it:

- Every source's picker stays mounted and hidden unless its part is selected. The column, relation,
  and step forms read each source's described fields from what its picker reports, and the old
  editor mounted them all at once too. Phase 4 could move describing into the store instead.
- Default columns and source labels that follow a source's description are `derived` changes. They
  join the undo step that picked the source and don't clear redo.
- The outline is one `Rows` list per section, so the arrow keys move within a section and **Tab**
  moves between sections.
- **Remove** is offered on sources and steps only. Columns are removed from their card.
- **Ask AI about this** fills the AI request with the part's title. `AuthoringConversation` gained
  an optional `instruction` prop for it.
- The toolbar's **Publish…** is enabled once the plan has a source, and the review's **Publish**
  carries the gate, listing each blocker.
- The preview's cell is a twelfth of the preview area, without the grid's gaps, so a wide panel
  previews a little larger than it places.
- Undo and redo answer both ⌘ and Ctrl on every platform.
- `planPartLabel` stays: problem lines read "Title is incomplete." and outline titles are too long
  for that.

Checked in a `dev:agent` session: **Add panel** on Home, **Pick data**, **Workspace tasks**, a
filter step from **Add**, undo, redo, the publish review, and **Publish**, which placed the panel on
Home. The driver has no hover or key press, so **Edit** from the panel menu, ⌘Z, and **Escape**
were checked only in `PanelStudio.test.tsx`. The session had no plugin with a pane aside, so the
studio over a task wasn't checked.

Left for later phases:

- The inspectors are the old forms. [Phase 4](./04-inspectors.md) rewrites them.
- The blank studio's **Pick data** and **Describe it** stand in for [phase 5](./05-launcher.md)'s
  launcher.
- The AI is a dialog. [Phase 6](./06-docked-ai.md) docks it and removes the requirements gate.

