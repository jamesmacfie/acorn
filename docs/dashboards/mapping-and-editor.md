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

The editor uses the shared data controls for source choice, scope, parameters, predicates, sort, and
preview ([authoring controls](../data-sources/authoring-controls.md)). Mapping and display settings
are pure `dashboards-core` projections. Publishing is the boundary between editable drafts and a panel
you can place or sample. **Edit** on a placed panel runs **Refresh preview** once when it opens. A
preview reads the source and writes nothing to the draft. The preview is the real panel:
`views/PanelBody.tsx` over the same projection a placed panel runs.

Everything that can be wrong is a pure function in `packages/dashboards-core`, not in a component,
because the Node's sampler must compute a panel's number with the same functions the renderer uses
([sampling](./sampling.md)), and a client package can't enter the Node's graph. That also covers every
scale, tick, and rect.

`dashboardEditorModel.ts` holds the draft, and `dashboardRecovery.ts` keeps a device copy for
recovery. Old flat panel definitions are rejected by the versioned parser.
