# 10-18. The panel editor, beyond 02-8

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

**Edit** opens the panel editor on "Preview ready after refresh" while the live panel sits behind it.
Choosing a source adds a second AI authoring box inside Data. The source picker's second line is the
plugin id ("core · Tasks"). Preview records list as uppercase folds. Mapping options read "{label} ·
{JSON pointer}", and the visible-field checkboxes use role names. The placed panel never passes its id,
so a stat trend could only ever say "Collecting…".

## Where to see it

Home › **Add panel** (choose a source), and a placed panel's **Edit**.

## The fix

The partial fix. Whether to build stat trend controls or drop the trend code is a product call, deferred
(see [deferred.md](../deferred.md)).

- `packages/client-core/src/features/dashboards/DashboardEditor.tsx:240-360`: **Edit** runs **Refresh
  preview** once on open. Mapping options show the label, with the pointer as a tip. Visible-field
  checkboxes use the source's labels.
- `packages/client-core/src/features/dataSources/SourceQueryEditor.tsx:409-493`: per-query AI authoring
  folds closed by default. Source rows show the provider's name, not "core · Tasks". Preview record
  folds use `level="sub"`.
- `PublishedDashboardPanel.tsx:72-80`: pass `panelId={props.definition.id}` to `PanelBody`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DashboardEditor.tsx:266` | Data {n} | Rewrite | Query {n} |
| `DashboardEditor.tsx:291` | Use exact source states | Rewrite | One column per state |
| `DashboardEditor.tsx:292` | Add board column / Column {n} | Keep | |
| `DashboardEditor.tsx:303` | Not mapped | Keep | |
| `DashboardEditor.tsx:304` | Unavailable · {pointer} | Rewrite | {pointer} (no longer in the source) |
| `DashboardEditor.tsx:305` | {label} · {pointer} | Rewrite | {label}, with the pointer as its tip |
| `DashboardEditor.tsx:313` | Unmapped | Rewrite | No column |
| `DashboardEditor.tsx:320` | Unavailable state mappings retained for repair: {ids}. | Rewrite | Some states no longer exist in the source: {ids}. Map them again or remove them. |
| `DashboardEditor.tsx:322` | Suggest columns from state categories | Keep | |
| `DashboardEditor.tsx:345` | Preview is out of date | Keep | |
| `SourceQueryEditor.tsx:411` | Choose records… | Keep | The plan's overrule: "records" is the workflows word, and the editor is shared. |
| `SourceQueryEditor.tsx:413` | Search sources and saved queries | Keep | |
| `SourceQueryEditor.tsx:491` | Read {date} · preview limit 25 | Rewrite | Showing up to 25 |
| `SourceQueryEditor.tsx:37, 493` | Preview failed / The source returned {code}. Previous results are retained. Choose Refresh preview to retry. | Rewrite | Title "Couldn't load a preview". Body: the plain reason, then "The last preview stays until you refresh." |
| (picker meta) | core · Tasks / github · Pull requests | Rewrite | The provider's name, or nothing |

## What earlier batches give you

- **`pluginLabel`** (K5), for the provider's name in the source picker.

## Risk and checks

- Before you start, confirm running **Refresh preview** on open does not write the draft.
- `SourceQueryEditor.tsx` is shared with the workflow editor's Find records step. Check that step too.
- Screens: the source picker, the preview, a board, and **Edit** on a placed panel.
- Tests: the client-core dashboards and data-source tests.
