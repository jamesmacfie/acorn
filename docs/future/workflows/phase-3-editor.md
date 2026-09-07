# Phase 3: the editor

Status: not started. Waits on phases 1 and 2.

## Goal

A person opens Workflows in the left rail, picks a definition or makes a new one, and edits it as a
list of nodes with an inspector, on the desktop and in the terminal client. The inspector draws each
kind's fields from its description and each agent node's harness options from the provider. A JSON
tab is the escape hatch. Save writes the row; Save to repo writes the file; Run opens the start
dialog.

## Why this phase, and why now

This is the ask. Phases 0 to 2 exist so that this one is a client feature and not a rewrite. The
list form comes before the canvas because it is kit-only, so the terminal client gets it for free,
and because every rule the canvas needs (the draft model, validation, rename) is proven here first.

## Scope

In: the rail source, the project surface, the draft model and its operations, the list column, the
inspector for nodes, the definition, and inputs, the JSON tab, the validity footer, Save, Save to
repo, Run and the start dialog, Copy to database for a file, layout preferences (written by nothing
yet), the palette's "New workflow" and the input-aware "Run a workflow", as
[05-ui.md](./05-ui.md) specifies.

Out: the canvas (phase 6); the run pane (phase 4); the item menu (phase 5).

## Design detail

**Draft model.** `plugins/workflows/src/client/editor/draft.ts` (new) is pure: a `WorkflowDraft`
(the definition plus a selection and an undo stack) and operations `addNode(kind, afterSelected)`,
`removeNode(name)`, `renameNode(old, next)` (rewrites references in every prompt, `with` string,
and `after`), `connect(from, to)` and `disconnect(from, to)` (refusing self, duplicate, and cycle),
`setField(name, fieldId, value)` (consulting `FIELD_HOME` for a built-in), `setInputs`,
`applyJson(text)` (atomic), `toDefinition()`. Undo is a bounded array of drafts with typing coalesced
by a 600 ms window in the store, not in the pure module.

**Store.** `plugins/workflows/src/client/editor/draftStore.ts` (new) holds the draft as a Solid
store per open definition, the catalog and provider descriptors as resources, the debounced validate
call against `POST /v2/p/workflows/defs/validate`, the dirty flag, and the save calls with revision
handling.

**Surface.** `plugins/workflows/src/client/surfaceContribution.ts` (new) registers the
`ProjectSurfaceContribution` at `/p/:projectId/x/workflows/:item` with `item: 'item'`.
`plugins/workflows/src/client/editor/WorkflowEditor.tsx` (new) is the `list-detail` layout's four
regions from one file, as the changes plugin does: header (back, name, `Graph | JSON` tabs with
Graph disabled until phase 6, Save, Save to repo, Run), list, detail, footer.

**List column.** `NodeList.tsx` (new): a `Rows` collection over the graph order with depth, kind
label, and the `⇐ n` mark; "Definition" and "Inputs" as the first two rows; the **Add** menu over
the catalog; Backspace and Delete handling per the draft rules.

**Inspector.** `NodeInspector.tsx` (new) dispatches on the selection. `FieldControl.tsx` (new)
renders one `StepField` as the matching kit control, with `optionsRoute` resolved through
`readJson` with the placeholders substituted from the surface's project and, when a task is chosen
for previews, its id. `AgentNodeForm.tsx` (new) draws harness, config options from `GET
/v2/p/agents/providers` (one select per option with `category` model, reasoning, mode, permission),
isolation, and the upstream-output toggle. `PromptField.tsx` (new) is the textarea with reference
chips. `BranchesField.tsx` and `JoinField.tsx` (new) draw the two built-in shapes the field
vocabulary does not cover.

**JSON tab.** `JsonTab.tsx` (new): a `CodeEditor` kit node when one is admitted or a plain
textarea otherwise, Apply, Format, Revert, and the invalid-state banner.

**Rail source.** `plugins/workflows/src/client/sourceContribution.tsx` (new) with `regions: {
list: WorkflowsBrowseList, detail: WorkflowsBrowseDetail }`, `order` after docker, no `providerId`.
The list reads the merged definitions for the active workspace and the recent runs, and re-reads on
`plugin:workflows:defs-changed` and `plugin:workflows:run-changed`.

**Start dialog.** `StartDialog.tsx` (new), an overlay over the kit's `Modal`, used by the editor's
Run, by the palette, and later by the item menu. It takes a definition summary, prefilled inputs,
and an optional task; when no task is given it draws a task picker over the project's active tasks.

**Layout preferences.** `layoutPrefs.ts` (new) reads and writes `plugin:workflows:layout:<defId>`
through the persisted-state seam, debounced. Nothing draws positions until phase 6; the module exists
so the rename rewrite and the delete cleanup are in place.

**Registration.** `plugins/workflows/src/client/index.ts` registers the source, the surface, and the
two commands. `apps/desktop/test/client/parity.snapshot.json` and
`apps/desktop/test/client/clientPluginDisable.snapshot.json` are regenerated.

## Code touched

- `plugins/workflows/src/client/sourceContribution.tsx` (new), `surfaceContribution.ts` (new).
- `plugins/workflows/src/client/editor/` (new folder): `draft.ts`, `draftStore.ts`,
  `WorkflowEditor.tsx`, `NodeList.tsx`, `NodeInspector.tsx`, `FieldControl.tsx`,
  `AgentNodeForm.tsx`, `PromptField.tsx`, `BranchesField.tsx`, `JoinField.tsx`, `JsonTab.tsx`,
  `StartDialog.tsx`.
- `plugins/workflows/src/client/layoutPrefs.ts` (new).
- `plugins/workflows/src/client/commands.ts`: "New workflow"; "Run a workflow" opens the dialog.
- `plugins/workflows/src/client/index.ts`.
- `plugins/workflows/src/client/WorkflowsSettings.tsx`: a line pointing at the rail; the list stays.
- `apps/desktop/test/client/parity.snapshot.json`, `apps/desktop/test/client/clientPluginDisable.snapshot.json`.

## Tests

- `plugins/workflows/src/client/editor/draft.test.ts` (new): rename rewrites every reference and
  `after` entry; delete detaches and never bridges; connect refuses a cycle and a duplicate; add
  after the selection sets `after`; applyJson with invalid text leaves the draft unchanged; undo
  depth is capped.
- `plugins/workflows/src/client/editor/NodeInspector.test.tsx` (new, through
  `@acorn/plugin-api/testkit/client`): a kind with three fields renders three controls of the right
  type; a `select` with `optionsRoute` renders the fetched options; an agent kind renders the
  provider's options and the isolation toggle; a `required` field empty disables Save.
- `plugins/workflows/src/client/commands.test.ts`: "Run a workflow" over a definition with a
  required input opens the dialog rather than starting.
- `apps/tui` reachability property picks up the new surface with no change.

## Docs owed

`docs/workflows.md` new § Authoring (the rail, the surface, the draft rules, the JSON tab, save to
repo); `docs/state-ownership.md` § Device (the layout key); `docs/command-palette-and-shortcuts.md`
(the two commands); `docs/first-party-plugins.md` (the workflows row gains a source and a surface);
`docs/testing.md` § The smoke checklist (edit, save, save to repo, run from the editor).

## Doors left open

- A rendered-prompt preview in the inspector, showing what a node would receive with the current
  upstream outputs. The data is a run's `inputsJson`; the preview would be a dry render.
- Templates: a "New from template" entry seeded with the owner's first workflow. One JSON file in
  the plugin; nothing else.
- Node positions in the definition were refused; the preferences key is the door.

## Done when

- The owner's first workflow can be built from an empty definition using only the editor, saved as a
  row, saved to the repo, and run from the editor's Run button with the inputs dialog.
- Opening the repo file it wrote shows the same nodes read-only.
- The same flow works in the terminal client except Save to repo's confirm, which is a modal the
  terminal draws too.

## Verify before building

- `ProjectSurfaceContribution` is still `{ id, path, item, order, component }`.
- `SourceContribution.regions` is still `{ list, detail }`, and the TUI's Browse panel still
  reads the list region.
- The kit has `Rows`, `Row`, `Tabs`, `Select`, `Field`, `Modal`, and a multi-line text input under
  `@acorn/plugin-api/ui`; check whether a code editor node exists for the JSON tab.
- `GET /v2/p/agents/providers` still answers descriptors with `configOptions`.
- `packages/client-core/src/host/registries/commands/clientEvents.ts` still keys pane intents on a
  closed union.
