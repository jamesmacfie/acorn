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

**Add panel**, through the launcher below, and a panel's **Edit** and **Edit with AI…** open the panel studio
(`studio/PanelStudio.tsx`), a full-window layer like Settings. It isn't a route, because a route would unmount the task's panes,
plugin frames, and terminal drawer behind it. Task keybindings stand down while it's open
(`isPanelStudioOpen` in `studio/studioOpen.ts`), **Escape** closes it, and focus returns to the
control that opened it. Closing never loses work, because each change autosaves.

The studio is laid out like the Workflows editor. The toolbar has a back button named for where the
studio was opened from, the panel title (click it to rename in place), the save state, whether the
panel is published or has unpublished changes, **Ask AI**, **Undo**, **Redo**, **Publish…**, and a
menu with **Discard changes** and **Delete panel**. The **JSON** tab shows the plan as read-only
JSON. The **Outline** tab shows the outline, the live preview, and an inspector. A status bar names
the first problem as a link to its part, and the changes since the last publish.

**Add panel** first opens the launcher (`studio/PanelLauncher.tsx`), a dialog that says what a panel
is and asks what it should show. **Edit** skips it. The launcher has three paths:

- **Describe it.** Type a request and choose **Draft it**. The studio opens with the request as the
  plan's `request` and the AI already asked. The model it drafts with sits on one line under the box.
  Up to four suggestions, after **Try**, are titles of starter plans from sources described earlier in
  the session, because the source catalog carries no starters. A suggestion fills the box only.
- **Start from data.** Pick a source or a saved query. Sources sit under where they come from, such
  as "Acorn" or "GitHub · Work" (`group` in `sourceEntries.ts`). A plugin region lists only the
  sources it accepts (`regionAllowsSource`). Picking one swaps the list for its starters and **Blank
  panel**, under the source and **Change source**. A starter reads as its view, steps, and sort
  (`planSummary`), moved onto the picked workspace, account, and reach, then validated by the Node.
  **Blank panel** selects **Columns**. A saved query has no starters and opens straight away.
- **Unfinished.** The workspace's unpublished drafts, newest first and three at a time, each with
  **Continue** and **Discard**.

A derived source lists once and asks for an account per input before its starters open. The studio
lists its inputs under it in the outline and draws their account pickers in its inspector. See
[derived sources](../data-sources/derived-sources.md#use-one-in-a-panel).

The launcher's choice is where editing starts, so undo never goes back past it. The source and
account list is `sourceEntries` in `features/dataSources/sourceEntries.ts`, which the source picker
uses too. In the studio, a source joins the plan only once it's picked, so nothing is reported before
then.

**Ask AI** docks the AI conversation (`AuthoringConversation` with `layout="dock"`) in the inspector's
column until you choose **Close**. The dock shows the turns so far, the model, a settings menu with
**Use preview records to help AI**, and a box to type in. **Edit with AI…** opens the studio with the
dock open. **Ask AI about this**, on an outline row or in the column list, fills the box with "About
*part*: " and sends the part's JSON pointers ahead of the message, such as
`[Focus: /stages/1 "Keep where Author is you"] `. The Node's prompt tells the model to change other
parts only when the request needs it. A new panel's conversation moves from its `new:<workspaceId>`
key to the draft's id when the Node assigns one (`moveAuthoringConversation`).

When a proposal arrives, the studio reviews it (`reviewProposal` in `studioStore.ts`). The proposal
is rebased onto the plan as it is now (`mergeAuthoringCandidate`), and a conflict ends review with
"This panel changed while the proposal was prepared." During review, the outline shows the proposed
plan compared by `diffOutline`. Added and changed rows carry a mark, a removed step stays struck
through where it was, and the Columns row lists the column changes. The preview switches between
**Before** and **After**, and **After** gives the row count it had before. The inspector is read-only,
undo and redo wait, **Publish…** is off, and the status bar sums up the proposal. In the dock, the
proposal lists the plan's requirements, each linked to its part, what it didn't cover, and any
problems, which turn **Apply** off. **Apply** has the Node validate the plan, then applies it as one
undo step. **Discard**, or sending another message, ends review.

Requirements don't block publishing, because applying a proposal accepts it. Requirements that
aren't fully covered, and what the last applied proposal didn't cover, show as warnings in the publish
review and as a link in the status bar that opens the dock.

The outline draws `planOutline` in the sections Data, Columns, Steps, Arrange, Look, and Settings.
Each row shows its row count, such as "312 → 41" for a step, and a warning mark when the part has a
problem. **Add** adds a source, a column, or a step, and disables a step the plan can't take yet with
the reason. A row's menu moves a step, removes a source or step, or asks the AI about the part.
Selecting a row shows its form in the inspector (`studio/inspectors.tsx`, one form per kind of part),
under a line saying what the part is for (a step's is `OPERATION_HELP`). With nothing selected, the
inspector lists a panel's parts in the order they apply. Every control has a visible caption, and
every option reads as words from `packages/dashboards-core/src/labels.ts` rather than a schema value.
Each form shows only what applies to its part. A column shows the settings for its type only.
**Look** lists each view with what it's for (`VIEW_HELP`), or why the plan or the region refuses it,
and offers only the options the chosen view takes. A source's inspector lists its starter plans
under **Start over from a starter panel**, which replaces the whole plan, moved onto the source's
account and validated as in the launcher. **Keep history** can create a dataset from the query.

Each step operation has its own form, registered in `studio/operationForms.ts`. The registry's type
requires a form for every operation, and `operationForms.test.tsx` checks that each operation also
has an outline title and an **Add** entry. `authoringEvaluation.test.ts` checks it has an evaluation
case. A form receives the columns its step reads, which are the plan's columns after the steps before
it. Conditions pick their value by the column's type: a choice from the column's choices, **You** for
a person field whose source declares `viewerMatch`, and relative dates such as **Start of this week**
or **30 days ago** for a date. The filter form edits one level of **Match all** or **Match any**, and
a calculation nests two levels deep. A deeper predicate or calculation shows in words, to edit in the
**JSON** tab or with the AI. Each step's form ends with its row counts and its problems.

No form asks for an ID. A calculated column, a measure, an expanded item, or a new column gets one
from its label when it's created (`newColumnId` in `packages/dashboards-core/src/planColumns.ts`).
The ID is lower camel case, unique within the plan, and at most 100 characters. Renaming the label
keeps the ID, because later steps refer to the column by it. The **JSON** tab is the only place IDs
show.

The preview is the panel's body in a placed panel's card, at the size it would take on the dashboard,
nearest its placed rectangle. A table's column header selects that column; a group header, **Arrange**.
A preview with no rows says why: its first error, the source returning none, or the step that removed
the last rows (`emptyRunReason`). A number still draws its 0.

`studio/studioStore.ts` owns the plan, the selection, undo, redo, and autosave. Each change is one
undo step, typing within 600 ms is one step, and the stack holds 60 steps. Each change writes a
device recovery copy, and a plan that passes its schema saves to the Node 750 ms after the last
change.

The first source described creates one column per field with a display role (title, status,
assignee, url, updated), or its first six fields if it declares no roles (`defaultPlanColumns`), and a
panel still called "New panel" takes the source's name. That change joins the undo step that picked
the source. **Add a field**, in the Columns form, makes a column named and typed after a field no
column reads yet. Choosing the field of a column that reads one source takes the field's type, and
its name while it's still "New column" or the last field's name (`bindColumnField`). Rows are
filtered by the panel's own filter step, which the Node pushes down to the source, so the source
picker hides **Add condition** and its own preview. Conditions a query already has show read-only,
because they change which records come back.

**Publish…** opens a review that lists what changes since the last publish, or what a new panel
shows, where it goes (a Home tab for a new Home panel), the requirements warnings above, and anything
blocking: a schema failure, a run error, or a region that wouldn't show the panel. `publishPanelPlan` in
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
