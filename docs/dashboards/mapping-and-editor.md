# Mapping and the editor

This page covers how one panel combines rows from several sources, and how the editor builds a panel.
The mapping rules are in `packages/dashboards-core/src/mapping.ts`, and the editor is
`packages/client-core/src/features/dashboards/DashboardEditor.tsx`.

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

**Add panel** always opens a blank plan with **Pick data** or **Describe it**. If an unpublished draft
exists, one line above them names the newest, with **Continue** to reopen it and **Discard** to delete
it. The source picker shows source and account pairs, and a source joins the plan only once it's
picked, so nothing is reported before then. The AI conversation asks for missing choices and
proposes the same plan used by the forms.

The editor shows the title, then data, relations (with two or more sources), columns, steps, and
**Arrange**, **Look**, row actions, and **Settings**. Every control has a visible caption, and every
option reads as words from `packages/dashboards-core/src/labels.ts` rather than a schema value. **Look**
offers only the options the chosen view takes. Each step's fold shows its row count, such as "Keep
matching rows · 312 → 41". Source descriptions may offer starter plans, which the host validates and
lists under **Start from**. **Keep history** can create a dataset from the chosen query.

The first source described creates one column per field with a display role (title, status,
assignee, url, updated), or its first six fields if it declares no roles (`defaultPlanColumns`).
Rows are filtered by the panel's own filter step, which the Node pushes down to the source, so the
source picker hides **Add condition** and its own preview. Conditions a query already has show
read-only, because they change which records come back.

Problems show under the part they belong to, such as "Column Status", with the JSON Pointer in the
hover title. **Publish** stays off while the plan fails its schema or the latest preview reports an
error, and the reason shows beside it. Each change autosaves the draft and a device recovery copy.

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
