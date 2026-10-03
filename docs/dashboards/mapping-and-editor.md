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

`PanelMappingColumn` is a record per column, with a reserved `writeValue`, because value mappings are
many-to-one and a future drag-to-update would need a designated value per column. Nothing reads it.
None of this layer is reachable from a manifest, and none of it grew the wire format.

## The generated editor

No panel settings form is written by hand, because a hand-written form drifts from its schema. The
editor's controls are selectors over the schema they draw from: pick a field of a type, a comparison
that type can answer, a value drawn by the field's type, and a tone. Selectors make a bad choice
unofferable. `normalizePanel` drops stale choices no selector catches, such as a filter on a field that
disappeared when you swapped the source.

**Add panel** starts with **Pick data** or **Describe it**. The source picker shows source and account
pairs; the AI conversation asks for missing choices and proposes the same plan used by the forms.
The editor shows columns, filter stages, view options, the host's plan description, and a live Node
preview. Source descriptions may offer starter plans, which the host validates before showing them.
Each change autosaves the draft and a device recovery copy.

`PanelPlan` version 2 permits primary sources and `filter` stages. The closed capability list in
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
