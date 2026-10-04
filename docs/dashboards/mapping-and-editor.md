# Mapping and the editor

This page covers how one panel combines rows from several sources, and how the editor builds a panel.
The mapping rules are in `packages/dashboards-core/src/mapping.ts`, and the editor is the panel
studio in `packages/client-core/src/features/dashboards/studio/`.

## The mapping layer, and cross-source panels

A panel goes through the mapping layer when it has more than one source, declared columns, an
invented field, or an explicit field or value mapping (`isMapped`). Otherwise its rows pass through
unchanged. Three sub-layers apply in order:

1. **Field mapping** says which of a source's fields feeds each panel-local field.
2. **Value mapping** says which of a source's enum values land in each of the panel's columns.
3. **The derived enum** is the columns themselves, with labels and tones you invented.

These are decisions, not implementation details:

- **A mapped panel's fields are the five roles, plus fields you invent.** The roles are what the host
  can align without asking, and also a ceiling: GitHub's `repo` and Linear's `identifier` have no
  role. So you can declare a panel-local field with a name and one of the seven types, and say per
  source which field feeds it. It renders, sorts, filters, and groups like any other field.
- **A row's source is a field too.** A panel over several sources grows a `source` enum, fed by the
  host's stamp, with no tone, because provenance is identity. So `series` can split a line by source,
  and a filter can hide one source.
- **The derived enum is the panel's `status` field**, so a board draws your columns without knowing a
  mapping exists. `unmapped` chooses the catch-all column or hiding the row, never silent loss.
- **`bySource` is keyed by `<pluginId>:<sourceId>`**, never by array position, so removing a source
  can't rebind another's mapping.
- **The role is the default at run time, not a copy.** A panel that never opened the mapping step
  still unions correctly. An explicit `''` means "this source has nothing here", unlike an absent key.

The older `PanelMappingColumn.writeValue` remains part of the legacy mapping model. Published version
2 plans use explicit `writeValues` on each enum choice, keyed by source instance. A choice with no
declared value for that source cannot be a write target. None of this layer is reachable from a
manifest.

## The generated editor

No panel settings form is written by hand, because a hand-written form drifts from its schema. The
editor's controls are selectors over the schema they draw from: pick a field of a type, a comparison
that type can answer, a value drawn by the field's type, and a tone. Selectors make a bad choice
unofferable. `normalizePanel` drops stale choices no selector catches, such as a filter on a field that
disappeared when you swapped the source.

**Add panel** and a panel's **Edit** open the panel studio (`studio/PanelStudio.tsx`), a
full-window layer like Settings. It isn't a route, because a route would unmount the task's panes,
plugin frames, and terminal drawer behind it. Task keybindings stand down while it's open
(`isPanelStudioOpen` in `studio/studioOpen.ts`), **Escape** closes it, and focus returns to the
control that opened it. Closing never loses work, because each change autosaves.

The studio is laid out like the Workflows editor. The toolbar has a back button named for where the
studio was opened from, the panel title (click it to rename in place), the save state, whether the
panel is published or has unpublished changes, **Ask AI**, **Undo**, **Redo**, **Publish…**, and a
menu with **Discard changes** and **Delete panel**. The **Plan** tab shows the plan as read-only
JSON. The **Outline** tab shows the outline, the live preview, and an inspector. A status bar names
the first problem as a link to its part, and the changes since the last publish.

A blank panel shows **Pick data** and **Describe it**. If an unpublished draft exists, one line above
them names the newest, with **Continue** to reopen it and **Discard** to delete it. The source picker
shows source and account pairs, and a source joins the plan only once it's picked, so nothing is
reported before then. The AI conversation opens in a dialog, asks for missing choices, and proposes
the same plan used by the forms. Applying a proposal is one undoable step.

The outline draws `planOutline` in the sections Data, Columns, Steps, Arrange, Look, and Settings.
Each row shows its row count, such as "312 → 41" for a step, and a warning mark when the part has a
problem. **Add** adds a source, a column, or a step, and disables a step the plan can't take yet with
the reason. A row's menu moves a step, removes a source or step, or asks the AI about the part.
Selecting a row shows its form in the inspector (`studio/inspectors.tsx`, one form per kind of part).
Every control has a visible caption, and every option reads as words from
`packages/dashboards-core/src/labels.ts` rather than a schema value. Each form shows only what applies
to its part. A column shows the settings for its type only. **Look** offers only the options the
chosen view takes, and disables a view the plan or the region refuses, with the reason as its
tooltip. Source descriptions may offer starter plans, which the host validates and lists under
**Start from**. **Keep history** can create a dataset from the chosen query.

Each step operation has its own form, registered in `studio/operationForms.ts`. The registry's type
requires a form for every operation, and `operationForms.test.tsx` checks that each operation also
has an outline title and an **Add** entry. `authoringEvaluation.test.ts` checks it has an evaluation
case. A form receives the columns its step reads, which are the plan's columns after the steps before
it. Conditions pick their value by the column's type: a choice from the column's choices, **You** for
a person field whose source declares `viewerMatch`, and relative dates such as **Start of this week**
or **30 days ago** for a date. The filter form edits one level of **Match all** or **Match any**, and
a calculation nests two levels deep. A deeper predicate or calculation shows in words, to edit in the
**Plan** tab or with the AI. Each step's form ends with its row counts and its problems.

No form asks for an ID. A calculated column, a measure, an expanded item, or a new column gets one
from its label when it's created (`newColumnId` in `packages/dashboards-core/src/planColumns.ts`).
The ID is lower camel case, unique within the plan, and at most 100 characters. Renaming the label
keeps the ID, because later steps refer to the column by it. The **Plan** tab is the only place IDs
show.

The preview is the panel's own body in a placed panel's card, at the small, medium, or large size it
would take on the dashboard. A placed panel starts at the size nearest its placed rectangle. Clicking
a table's column header selects that column, and clicking a group header selects **Arrange**.

`studio/studioStore.ts` owns the plan, the selection, undo, redo, and autosave. Each change is one
undo step, typing within 600 ms is one step, and the stack holds 60 steps. Each change writes a
device recovery copy, and a plan that passes its schema saves to the Node 750 ms after the last
change.

The first source described creates one column per field with a display role (title, status,
assignee, url, updated), or its first six fields if it declares no roles (`defaultPlanColumns`). That
change joins the undo step that picked the source. Rows are filtered by the panel's own filter step,
which the Node pushes down to the source, so the source picker hides **Add condition** and its own
preview. Conditions a query already has show read-only, because they change which records come back.

**Publish…** opens a review that lists what changes since the last publish, where the panel goes (a
Home tab for a new Home panel), the requirements to confirm, and anything blocking: a schema
failure, a run error, or a region that wouldn't show the panel. `publishPanelPlan` in
`panelPublish.ts` saves the draft, describes each source to find its `plugin:source` keys and field
roles, checks them against the region, publishes, and refreshes every panel showing it.

`packages/dashboards-core/src/outline.ts` owns the plan's parts in plain words. `planOutline` splits a
plan into keyed parts: each source, relations, columns, each step by index, arrange, look, behaviour,
and settings. `columnParts` adds one part per column. `partForPath`, `problemsByPart`, and
`countsByPart` put a problem or a row count on its part. `availableOperations` and `availableViews`
say which steps and views a plan can take, and why not. `diffOutline` compares two plans part by
part. Steps have no ids, so it matches identical steps first, then the rest in order by operation.
`describePanelPlan` reads the same filter, reach, and press wording, so a run's description and the
outline say the same thing.

`PanelPlan` version 2 permits primary, lookup, and children sources and up to eight ordered stages.
The closed capability list in
`packages/dashboards-core/src/capabilities.ts` defines the available operations and view options. Columns can
inherit choice tones and ranks, display lists as chips, and carry fixed or per-row units. The time
policy stores an IANA zone, fixed or viewer display mode, and week start. Calendar days stay calendar
days. Validation reports JSON Pointer paths for missing or retyped bindings, incompatible operations,
sorts, groups, and view fields. A run leaves a changed column unavailable and reports a rebind notice;
new enum values appear in an unmatched-value notice.

The Node pushes supported filters to source queries only when their semantics match. It applies a
source's own limit before panel filters, and warns when that order could hide rows. A final sort and
limit may become a source `take` when no later stage changes the result. Per-provider scheduling,
rate-limit backoff, and record, time, intermediate-row, and byte budgets bound reads. The sampler
uses the same Node runner and the plan's stored time policy.

Version 1 panels read through a pure upgrade with a fixed UTC policy. Saving a draft writes version
2. Stored published version 1 bytes and digests remain unchanged.

The old flat panel form and client collection registry do not exist. Old definitions are rejected by
the versioned persistence parser and are recoverable only from the workflow-v2 transition export.

Everything that can be wrong is a pure function in `packages/dashboards-core`, not in a component,
because the Node's sampler must compute a panel's number with the same functions the renderer uses
([sampling](./sampling.md)), and a client package can't enter the Node's graph. That also covers every
scale, tick, and rect.

`dashboardEditorModel.ts` holds the draft, and `dashboardRecovery.ts` keeps a device copy for
recovery. Old flat panel definitions are rejected by the versioned parser.
