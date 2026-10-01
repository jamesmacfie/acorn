# 07-8. The inspector says the same thing three or four times

**Status:** not started. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

For a new **Run a command** step, "Run one shell command in the task's checkout and hand its output
to the next step." appears in the Add menu's tip, in the outline row, under the inspector heading, and
as the first line of **Preview**. "Starts the run" appears three times. **Waits on**'s hint repeats
the line above it, and stays when the step does wait on something. **Preview** lists developer paths
such as `values.version · string`. The repetition pushes the fields people came to fill below the
fold, and the paths are for the plugin's author, not the workflow's.

## Where to see it

Workflows › any definition › add a **Run a command** step and an **If** step, then read the outline
row, the inspector, and **Preview**.

## The fix

- `plugins/workflows/src/client/editor/NodeInspector.tsx:156-158`: the kind description moves to the
  heading's `help`. Not to the badge: copy row 799 named the wrong host.
- `NodeInspector.tsx:184`: drop the **Waits on** hint.
- `NodeInspector.tsx:197`: "Nothing. This step starts the run."
- `NodeList.tsx:40-50, 180-184` and `outlineModel.ts:40-67`: a row shows a summary only when it is
  specific to that step (an If's condition, a For each's source, a Find records query). Otherwise it
  shows the kind label.
- `StepPreview.tsx`: drop the summary (`:42`) and the dependency chips. Show fields as plain names
  (`version`, not `values.version`). Show the preview-values line (`:52`) on Find records only. Any
  chip left is a `Badge`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `NodeInspector.tsx:157` | (kind description under the heading) | Move to `help` | On the heading, not the badge. |
| `NodeInspector.tsx:167` | Change the displayed label. References keep this step's stable ID. | Remove | |
| `NodeInspector.tsx:184` | Nothing here makes this a starting step. | Remove | |
| `NodeInspector.tsx:197` | Nothing — it starts the run. | Rewrite | Nothing. This step starts the run. |
| `NodeList.tsx:48` | Starts the run / After {names} | Keep | |
| `outlineModel.ts:44` | Plugin '{id}' does not provide this step on this node. | Rewrite | The {plugin name} plugin isn't on this computer. |
| `outlineModel.ts:49` | Find records with a saved query. | Keep | |
| `outlineModel.ts:51` | Find records from {pluginId} · {sourceId}. | Rewrite | Find {source name} records. |
| `StepPreview.tsx:42` | Starts the run. | Remove | |
| `StepPreview.tsx:49` | No structured output fields declared. | Rewrite | Returns no fields. |
| `StepPreview.tsx:50` | Available output fields | Rewrite | Later steps can use |
| `StepPreview.tsx:52` | Preview values appear in field pickers after a source query is tested. | Keep on Find records only | |
| `StepPreview.tsx:27` | left for the reviewer to fill / its default / a fixed value | Keep | |

The kind descriptions themselves (the "step-type blurbs") stay as they are. They feed the authoring
model, and rewriting them changes what the model sees. See [deferred.md](../deferred.md).

## What earlier batches give you

- **`Heading help`** (K3). The mark sits after the heading on its line.
- **`pluginLabel`** (K5) from `@acorn/plugin-api/client`, for "{plugin name}" in `outlineModel.ts`.

## Risk and checks

- Before you start, confirm `outlineModel.ts` is the only place the row summary is built.
- 07-9 reshapes the same rows. Do the two together.
- Screens: the outline and inspector for a command, If, Find records, and gate step.
- Tests: `plugins/workflows` (`NodeList`, `outlineModel` if present).
