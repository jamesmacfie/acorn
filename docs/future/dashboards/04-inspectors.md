# Phase 4: inspectors in plain words

Status: proposed, October 5, 2026. Depends on [phase 3](./03-studio-shell.md), and on the label
map from [phase 1](./01-quick-wins.md). Read the [programme README](./README.md) first. The
[Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) shows a filter step's
inspector in "The studio".

## Goal

Rewrite each inspector so a person who has never seen the plan schema can use it. Each form shows
only what applies to the selected part, uses the words in the label map, picks values with typed
controls, and never asks for an ID. Every stage form registers against its operation, so a new
operation can't ship without a form.

## Starting point

After phase 3, `inspectors.tsx` maps each part kind to a form moved from the old editor. Those
forms have these problems:

- The filter form handles one comparison per stage, while the schema allows `all` and `any`
  groups (`DataPredicate` in `packages/protocol/src/data/values/dataBindings.ts`).
- `CompositionStageForm.tsx` asks for **Result column ID**, **Measure ID**, and **Element column
  ID**. It labels expression kinds and measures with schema values.
- Column cards show every control for every column, whatever its type.
- The view options include every option for every view.
- Units, refresh, and offsets are free text.

Facts the forms need:

- Relative time values are context addresses: `now` with an offset matching `^[+-]P\d+[DW]$`, and
  `calendar` with a `boundary` of `startOfDay`, `startOfWeek`, or `startOfMonth` and an offset
  matching `^[+-]P\d+[DWM]$`. `viewer` with a `pointer` means "you". `workspaceLinks` means the
  workspace's linked items.
- A field that can match the viewer declares `viewerMatch` in its source description.
  `viewerPointer` in the old `DashboardEditor.tsx` reads it, for one-source plans only.
- Limits from `panelPlanSchema` in `packages/protocol/src/dashboards/panels.ts`: eight stages,
  eight sort keys, two group levels, three summary groups, 30 measures, 20 computed columns, three
  buttons, refresh from 30 to 86,400 seconds.
- `PANEL_CAPABILITIES` in `packages/dashboards-core/src/capabilities.ts` lists measures, units,
  precisions, buckets, group orders, and view options.

## Requirements

### The operation registry

1. Add `operationForms.ts` in the studio folder:

   ```ts
   export const operationForms = {
     filter: FilterForm,
     compute: ComputeForm,
     summarize: SummarizeForm,
     expand: ExpandForm,
     overlap: OverlapForm,
   } satisfies Record<PanelPlan['stages'][number]['op'], Component<StageFormProps>>
   ```

   The `satisfies` clause makes a missing operation a type error. `StageFormProps` is
   `{ stage, columns, plan, sources, onChange }`, where `columns` are the output columns at that
   point in the plan.
2. Add a test that every `PANEL_CAPABILITIES.operations` id has a form, a `planOutline` title, and
   an `availableOperations` entry. That is three of the four parts the programme rule requires. The
   fourth, evaluation cases, lives in `authoringEvaluation.test.ts`. Add a check there too if one
   isn't present.
3. Delete `CompositionStageForm.tsx` once its parts move into the new forms.

### IDs are never typed

4. A new computed column, measure, or expanded element gets an ID from its label when it's created:
   lower camel case, made unique within the plan, and at most 100 characters. Renaming the label
   later doesn't change the ID, because later stages refer to it. The **Plan** tab is the only place
   IDs show.

### Source

5. The source inspector shows, in order:
   - **Source**, the source and account picker from `SourceQueryEditor`.
   - **Account**, when the source has more than one usable account.
   - **Reach**, when the source declares one, as a `SegmentedControl`: **Everything this account
     can see**, **Workspace links**, or **Chosen items**.
   - Required scope parameters.
   - Existing source conditions, read-only, as phase 1 left them.
   - **How it joins**, only when the plan has more than one source: **Adds rows**, **Adds columns
     to each row**, or **Adds a list to each row**.
   - **Start from**, the source's starter plans, when it offers any.
   - **Keep history…** and **Remove source**.

### Columns

6. Selecting **Columns** shows one row per column: label, source field, and type. Each row has a
   menu with **Move up**, **Move down**, **Remove**, and **Ask AI about this**. Selecting a row selects
   `column:<id>`. An **Add column** button sits at the bottom.
7. Selecting a column shows:
   - **Name**.
   - **From**, one field `Select` per source, listing fields of a compatible type first, each with
     its type. A missing field shows as "*field* is missing, choose another". A suggested binding
     shows as a one-click chip.
   - **Type**, using the label map.
   - Type-specific settings, shown only for that type:
     - Number: **Unit**, a `Select` of Percent, Milliseconds, Seconds, Bytes, and Currency. Currency
       asks for a three-letter code. **Or read the unit from** another column.
     - Date and time: **Show as** a date and time, or a calendar day.
     - Choice: a table of choices with **Name**, **Colour**, and **Order**, the source values mapped
       to each choice, and the board write value when the source declares the field writable.
       **Values not listed** shows them under "Other" or hides them.
   - **Holds a list of values**, a checkbox.
   - **Prefer the value from**, only when an equivalence relation exists.

### Steps

8. **Keep matching rows** (filter):
   - One line per condition: column, operator, value. The operators offered depend on the column's
     type, using the label map ("is before" for dates).
   - The value control depends on the column: a choice `Select` for a Choice column, a person
     picker with **You** first for a Person column whose field declares `viewerMatch`, a date
     control with presets for a Date column, and a number or text input otherwise.
   - Date presets: Today, Start of this week, Start of this month, 7 days ago, 30 days ago, 90 days
     ago, and **A specific date**. They write `calendar` or `now` addresses with the offsets above.
   - **Match all of these** or **Match any of these**, shown once there are two conditions, writes an
     `all` or `any` predicate. One level of grouping is enough. Show a deeper stored predicate
     read-only, with "Edit this in the Plan tab or with AI."
   - A note when the filter runs at the source: "GitHub filters these rows itself, so the panel
     reads less." Show it only when the run's planned query includes the predicate. If the run
     doesn't report that yet, leave the note out rather than guess.
9. **Calculate columns** (compute): one card per calculated column with **Name** and **Calculation**.
   **Calculation** offers templates first, each filling the expression:
   - **Time between** two date columns, or a date column and now, in minutes, hours, or days.
   - **Arithmetic** on two values, each a column or a number.
   - **By choice**, a value for each choice of a Choice or Yes or no column, and **Otherwise**.
   - **First value that exists**, **Smallest of**, and **Largest of**, over a list of values.
   Nested expressions show as indented sub-forms, at most two levels deep in the form. Deeper
   expressions show read-only, as with filters.
10. **Summarize rows** (summarize):
    - **One row per**: up to three columns. A date column adds **By** day, week, or month.
    - **Measures**: one row per measure with **Name**, **Calculate** (Count, Count where, Sum,
      Average, Smallest, Largest, Median, Percentile, Number of different, List of different,
      Earliest, Latest), and **Of** a column when the measure needs one. Expand a row for **Only
      count rows where**, **Show as share of the total**, and **Change from the previous period**.
    - **Fill empty periods**, shown only when grouping by a date bucket.
    - **Split into columns by**, a Choice column, with the measure to split.
11. **Expand a list**: **List column** and **At most per row**.
12. **Find overlaps**: **Starts**, **Ends**, **Within each**, and **At most pairs**.
13. Every step form ends with the step's row counts, "312 rows in · 41 rows out", and any problem
    on that step in full.

### Arrange

14. **Sort by**: a list of up to eight keys, each a column and a direction in words ("Newest
    first" for dates, "Highest first" for numbers, "Z to A" for text). **Empty values**: first or
    last.
15. **Group by**: up to two levels. Each has a column, **Group** (Each value, By day, By week, By
    month, or Relative to now, which gives Today, This week, and Earlier), and **Order groups by**
    (The column's order, Name, Size, or a custom order you drag).
16. **Show at most**: a number of rows, empty for no limit.

### Look

17. **Show as**: a row of five choices, Table, List, Board, Stat, and Chart, each with an icon.
    Disable a view that `availableViews(plan)` or the region refuses, with its reason as a tooltip.
18. Then only that view's options, from `PANEL_CAPABILITIES.views[kind].options`:
    - Stat: **Number** (Count of rows, or Sum, Average, Smallest, or Largest of a column), **Trend**
      (None, Saved history, Recent activity), **Compare with** (None, Yesterday, Last week), and
      **Good direction** (Up, Down, Neither).
    - Chart: **Shape** (Bars or Line), **Across** (the x axis), and **Split by** (series).
    - List, Table, and Board: no options. The text "Board columns come from the first grouping."
      shows under Board.

### Behaviour

19. **When someone clicks a row**: **Do the source's default**, **Open the record**, **Open its
    task**, or **Open a link from** a link column. Offer only choices the last run supports, as the
    old editor does.
20. **Open in**: only the presentations the run's rows support, in words: Side panel, Task pane,
    Full page, Overlay, Browser.
21. **Buttons on each row**: up to three, each with **Label**, **Icon** (the kit `IconPicker`), and
    **Does** (Open, Start a task, or one of the source's named actions).

### Settings

22. **Refresh**: Automatic, Every minute, Every 5 minutes, Every 15 minutes, Every hour, Every day.
    Automatic leaves `refresh` unset.
23. **Time zone**: the zone `Select` from phase 1. **Dates show in**: Always this time zone, or
    Each viewer's time zone. **Weeks start on**: Monday, Sunday, or Saturday.

## Out of scope

- Editing predicates or expressions deeper than the levels above. The **Plan** tab and the AI
  cover them.
- New operations or view options. This phase changes how existing ones are edited.

## Tests

- `operationForms.test.ts`: the registry check in requirement 2.
- One `.test.tsx` per stage form under the client-core `hosts` tier. Each checks that the form
  writes a schema-valid stage for its main paths. Parse the result with `panelPlanSchema`.
- `FilterForm.test.tsx` also checks the **You** option appears only with `viewerMatch`, and that
  each date preset writes the right address.
- The ID rule in requirement 4: uniqueness, length, and stability across a rename.

## Check it in the app

Build "My open pull requests" by hand in a `dev:agent` session with a GitHub account, or build
"Tasks updated this week" from **Workspace tasks** without one. Use only the inspectors. Nothing on
screen should show a schema value, a JSON pointer, or an ID outside the **Plan** tab.

## Docs to update

- `docs/dashboards/mapping-and-editor.md` § The generated editor: the operation registry and the
  ID rule.
- `docs/plugin-authoring.md`: a source author's `viewerMatch` and starter plans now show in the
  editor, so say what each one changes for the person building a panel.

## Verify before building

- The kit has a date input. If not, use `Input type="date"` inside `Field`.
- `IconPicker` (`packages/client-core/src/kit/components/inputs/IconPicker.tsx`) fits a 320-pixel
  inspector.
- Whether the run reports pushed-down predicates in `diagnostics.sources`. It reports
  `queryDigest` and `parameters`. If neither says which predicates were pushed down, requirement 8's
  note waits for a Node change, which is out of scope here.
