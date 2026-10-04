# Phase 1: quick wins in the current editor

Status: shipped, October 5, 2026, in commit `5cb399885`. [What shipped](#what-shipped) records
the choices made while building it and what it left for later phases. Depends on nothing. Read the
[programme README](./README.md) first. The [Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) has the
screenshots this phase fixes.

## Goal

Fix the problems that don't need the studio, inside the existing `Modal`, so people get a usable
editor while the larger phases are built. Every change here either carries into the studio or is
deleted with the modal. None of it is throwaway structure.

## Starting point

The editor was `packages/client-core/src/features/dashboards/DashboardEditor.tsx`, deleted in phase 3. It was one
component of about 536 lines. Its state is a `PanelPlan` signal changed through
`change(update)`, which autosaves a device copy right away and a Node draft after 750 ms.

What the review found in the dialog:

- Most `Select` and `Input` controls have no visible label. The kit `Select` in
  `packages/client-core/src/kit/components/inputs/Select.tsx` uses `label` only as the accessible
  name. A visible caption comes from wrapping the control in `Field`
  (`packages/client-core/src/kit/components/inputs/Field.tsx`). The **View and timing** section
  renders as "list, count, None, None, None, bar, None, None".
- Every view option shows for every view. `PANEL_CAPABILITIES.views` in
  `packages/dashboards-core/src/capabilities.ts` already lists which options each view takes.
- Option labels are schema values: `primary`, `lookup`, `children`, `text`, `enum`, `eq`, `lte`,
  `ok`, `muted`, `column`, `coalesce`. Relative dates are typed as ISO 8601 durations such as
  `-P7D`. The time zone is a free text `Input`.
- **Pick data** calls `addSource()`, which adds a placeholder inline query with source
  `core/choose`. The preview then runs it and shows `/sources/0: Source 1 is unavailable` twice
  before anything is chosen.
- **Publish** is disabled only when `plan().sources.length` is zero. An invalid plan can be
  published until the Node rejects it.
- The preview renders each line of `describePanelPlan()` with `<Text wrap>`. `Text` is a `span`, so
  the lines run together: "One row per record from Workspace tasks.Columns: Task, …".
- Stage row counts render as debug text under the description:
  `/stages/0: 312 → 41 rows`.
- With no `dashboardId`, `onMount` loads `latestUnpublishedDashboard(await client.list())` from
  `dashboardEditorModel.ts`. **Add panel** reopens the newest abandoned draft with no explanation.
- The panel title is the first control in the last fold, **View and timing**. Sort, group, and limit
  live there too, away from the stages they belong with.
- The first described source creates up to 30 columns, one per field (`available.slice(0, 30)` in
  `updateState`).
- `SourceQueryEditor` draws its own **Add condition** and **Refresh preview** inside each source.
  The panel has its own filter stage and its own live preview, so people see two of each.

## Requirements

### Labels and words

1. Wrap every `Select` and `Input` in the editor and in `CompositionStageForm.tsx` in a `Field` with a
   visible label. Keep the `label` prop on the control as well, for its accessible name.
2. Add one label map, `labels.ts` in `packages/dashboards-core/src`, that turns schema values into
   words, and export it as `./labels.ts` in the package's `exports` map. Use it for every option list
   in the editor. Keep the stored values unchanged. It lives in `dashboards-core` rather than the
   client because [phase 2](./02-plan-outline-model.md) builds the Node's plan description on it.

   | Schema value | Shown as |
   | --- | --- |
   | `primary`, `lookup`, `children` | Adds rows, Adds columns to each row, Adds a list to each row |
   | `text`, `number`, `boolean`, `datetime`, `enum`, `person`, `link` | Text, Number, Yes or no, Date and time, Choice, Person, Link |
   | `eq`, `ne`, `lt`, `lte`, `gt`, `gte` | is, is not, is less than, is at most, is more than, is at least |
   | `lt`, `gt` on a date column | is before, is after |
   | `contains`, `in`, `missing`, `present` | contains, is one of, is empty, has a value |
   | `ok`, `warn`, `bad`, `muted`, `accent` | Green, Amber, Red, Grey, Accent |
   | `asc`, `desc` | Lowest or oldest first, Highest or newest first |
   | `fixed`, `viewer` | Always this time zone, Each viewer's time zone |
   | `column`, `literal`, `clock`, `arithmetic`, `duration`, `coalesce`, `choice`, `min`, `max` | A column, A fixed value, The current time, Arithmetic, Time between, First value that exists, By choice, Smallest of, Largest of |

3. Replace the free text offset `Input` with a preset `Select`: 1 day, 7 days, 14 days, 30 days, 90
   days ago, and 1 day, 7 days from now. Write the ISO duration the schema expects. If the stored
   offset isn't a preset, keep it as the selected option and label it with its value.
4. Replace the time zone `Input` with a `Select` over `Intl.supportedValuesOf('timeZone')`. Copy the
   `timezoneOptions` helper in `plugins/workflows/src/client/schedules/ScheduleDialog.tsx`, which
   keeps an unknown stored zone in the list. Move that helper into a shared spot if a second copy
   bothers the reviewer.
5. Show problems by their label, not their pointer. Map a problem `path` to the outline name of the
   part it points at ("Source 1", "Column Status", "Step 2"), and show the message once. Keep the
   path in a `title` attribute for debugging.
6. Give the choice rank input a visible label, "Order".

### Only what applies

7. In **View and timing**, draw an option only when `PANEL_CAPABILITIES.views[kind].options`
   includes it. `list` and `table` show no view options.
8. Hide the relation **Preferred source for equivalent records** select unless an equivalence
   exists. This already happens. Keep it.
9. Collapse **Relations**, **When a row is pressed**, and **Row buttons** by default. Hide
   **Relations** entirely while the plan has one source.

### Order of the form

10. Move **Panel title** to the top of the form, above **Data**.
11. Move sort, group, and limit out of **View and timing** into a fold named **Arrange**, directly
    after **Stages**. Rename **View and timing** to **Look** and keep refresh and time settings in a
    fold named **Settings** after it.

### Feedback

12. **Pick data** no longer calls `addSource()`. It shows the source picker with no source in the
    plan. The first pick adds the source. No problem shows until there is a source to describe.
13. Disable **Publish** while `panelPlanSchema.safeParse(plan())` fails or the latest preview run
    has an `error` problem. Show the first problem's message beside the button.
14. Render the description lines as a block list, one line each, so they no longer run together.
15. Show each stage's row count in its fold label, such as "Keep matching rows · 312 → 41". Remove
    the separate debug lines from the preview.
16. Make the save badge small and inline in the modal header area rather than a full-width bar.

### Defaults

17. When the first source is described, create columns only for fields with a `display.role`
    (`title`, `status`, `assignee`, `url`, `updated` in
    `packages/protocol/src/data/values/dataBindings.ts`). If a source declares no roles, take the
    first six fields. Put the rule in `dashboardEditorModel.ts` as a pure function with a test,
    because phase 5 reuses it.
18. Show starter plans as a labelled group, **Start from**, above the columns, not as ghost buttons
    under the source picker.

### One filter, one preview

19. Add two props to `SourceQueryEditor`: `hideConditions` and `hidePreview`. The dashboard editor
    sets both. Workflow step editing in `plugins/workflows/src/client/editor/StepConfigurationFields.tsx`
    keeps the defaults, so nothing changes there.
20. `hideConditions` hides **Add condition** only while the query has no predicate. A query that
    already has source conditions shows them read-only, with the note "These conditions run inside
    the source." Removing them is a separate decision. Don't drop them, because they change rows.
21. `hidePreview` hides **Refresh preview** and the record folds. `previewOnOpen` has no effect
    while it's set.

### Drafts

22. Stop the silent resume. With no `dashboardId`, open a blank plan. If an unpublished draft exists,
    show one line above the two entrance buttons: "You have an unfinished panel, *title*, edited
    *relative time*." with **Continue** and **Discard** buttons. **Discard** deletes the draft through
    `client.delete(id, draftRevision)`.

## Out of scope

- Moving the editor out of the modal. That's [phase 3](./03-studio-shell.md).
- Rewriting the stage forms. [Phase 4](./04-inspectors.md) replaces them.
- Any change to the AI conversation. That's [phase 6](./06-docked-ai.md).

## Tests

- `dashboardEditorModel.test.ts`: the default column rule (roles present, no roles, more than six
  fields).
- `labels.test.ts` in `packages/dashboards-core/src`: every value in each schema enum has a label. Read the enums from the
  zod schemas in `packages/protocol/src/dashboards/panels.ts`, so a new schema value fails the test
  until it gets a label.
- `SourceQueryEditor.test.tsx`: `hideConditions` with and without an existing predicate, and
  `hidePreview`.
- A `DashboardEditor.test.tsx` under the client-core `hosts` project (jsdom) that renders the editor
  with a stubbed client and checks two things: no problem renders before a source is picked, and
  **Publish** is disabled for an invalid plan.

## Check it in the app

Start `pnpm dev:agent -- --session panels`, then follow the steps in
[the README](./README.md#check-it-in-the-app). Open **Add panel**, choose **Pick data**, and pick
**Workspace tasks**. You should see five or fewer columns, labelled selects, and no problem text.

## Docs to update

- `docs/dashboards/mapping-and-editor.md` § The generated editor: the default column rule, the
  hidden source conditions, and the draft prompt.

## Verify before building

- `Field` around a `Select` with `size="sm"` lays out correctly in the two-column modal grid.
- `latestUnpublishedDashboard` has no caller other than `DashboardEditor.tsx`.
- `SourceQueryEditor` has three callers: itself in tests, the dashboard editor, and
  `StepConfigurationFields.tsx`.

## What shipped

All 22 requirements shipped, and the behaviour was checked in a `dev:agent` session as well as by the
tests listed above. The shipped behaviour is described in
`docs/dashboards/mapping-and-editor.md` § The generated editor, which wins over this page.

Where the code lives:

- The label map is `packages/dashboards-core/src/labels.ts`. Besides the table in requirement 2, it
  labels measures, views, aggregates, chart shapes, group buckets, week starts, arithmetic, duration
  units, and the relative offset presets. It also holds `planPartLabel`, which names the part a
  problem path points at, and `operationLabel`. Phase 2 can build the outline names on
  `planPartLabel`.
- `labels.test.ts` walks the zod schemas through their `def.type` rather than importing zod, because
  `dashboards-core` doesn't depend on zod.
- The default column rule is `defaultPlanColumns` in
  `packages/client-core/src/features/dashboards/dashboardEditorModel.ts`. Workspace tasks starts with
  three columns: Task, Status, and Updated.
- `LabeledSelect` and `LabeledInput` in `packages/client-core/src/features/dashboards/fields.tsx`
  wrap a kit control in a `Field` with a visible caption. The editor and `CompositionStageForm.tsx`
  use them for every select and text box.
- Adding `labels.ts` to the package's `exports` map raised the entrypoint count for
  `@acorn/dashboards-core` in `tools/arch/boundaries.test.ts` from 14 to 15.

Choices made while building it:

- **Stages** is renamed **Steps**, with **Add step** and **Remove step**, to match the programme's
  terms. Step folds read "Step 2 · Keep matching rows · 312 → 41".
- The folds run in the order the README lists parts: title, **Data**, **Relations**, **Columns**,
  **Steps**, **Arrange**, **Look**, **When a row is pressed**, **Row buttons**, and **Settings**.
  **Settings** also holds the dashboard placement select.
- **Arrange** shows the sort order only after a sort column is picked, and the group bucket only
  after a group column is picked.
- **Add another source** opens an empty source picker with a **Cancel** button. The source joins the
  plan only when one is picked, so the `core/choose` placeholder is no longer written by the editor.
- The offset list starts with **No offset**. Choosing it removes the stored offset, where the old
  free text field couldn't clear one.
- The time zone helper is copied from the workflow schedule dialog rather than shared. A plugin can
  reach client-core only through `@acorn/plugin-api`, and the copy is three lines.
- The save badge sits in its own row at the top of the form. The kit `Modal` takes only a string
  title, so the badge can't go in the header itself without a kit change.
- Problems are shown once per message, and the part name and message share one line, such as
  "Column Status: …". **Publish** shows "Title is incomplete." style reasons for a schema failure,
  using the first zod issue's path.
- With no `dashboardId`, a device recovery copy for `new:<workspace>` still reopens silently. It
  exists only when the Node never accepted a save, so it protects edits rather than resuming an
  abandoned draft.
- Relations now read "Source A blocks Source B" with source labels, where they showed source IDs.

Left for later phases:

- Any edit inside a step collapses that step's fold. The editor's `For` over `plan().stages`
  remounts a step whenever its object changes, and the fold has no `defaultOpen`. The old editor did
  the same. Phases 3 and 4 replace these forms, so they should keep each step's identity across
  edits, as phase 2's derived part identity allows.
- The plan description still prints schema values, such as "Keep rows where Updated eq -P30D from
  now". It comes from `describePanelPlan` in `packages/dashboards-core/src/plan.ts`, which
  [phase 2](./02-plan-outline-model.md) rebuilds on `labels.ts`.
- The requirements checklist still gates **Publish**. [Phase 6](./06-docked-ai.md) removes it.
