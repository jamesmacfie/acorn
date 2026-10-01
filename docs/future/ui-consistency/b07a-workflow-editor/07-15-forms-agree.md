# 07-15. The workflow forms disagree with each other

**Status:** not started. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The inspector and the start dialog use sm controls, the schedule dialog uses md, and
`TypedValueField` is always sm, so the schedule dialog stacks 32, 26, 32, 32. The inputs editor
promises a description is "Shown beside the box", and the start and schedule dialogs never show it.
The same limits have three vocabularies and two units: milliseconds in the inspector, hours in the
schedule dialog, and a sentence in the start dialog. Someone who sets a limit in minutes on one
screen and hours on another will get one of them wrong.

## Where to see it

Workflows › a definition › **Definition** (limits), **Inputs** (the Required button), **Run…** (the
start dialog when an input is needed), and **Schedule…** from the overflow menu.

## The fix

This is the partial fix. An app-wide convention for marking required fields is deferred: leave " *"
and "Required." as they are (see [deferred.md](../deferred.md)).

- `plugins/workflows/src/client/editor/TypedValueField.tsx:35`: take `size` (default md) and `hint`.
  The start and schedule dialogs pass the input's description as the hint.
- `InputsInspector.tsx:54-57` and `SchemaFieldEditor.tsx:62-65`: the Required/Optional button becomes
  `Checkbox label="Required"`.
- `DefinitionInspector.tsx:55-73` and `plugins/workflows/src/client/schedules/ScheduleDialog.tsx:308-310`:
  name the limits once ("Most child tasks", "Agents at once", "Time limit"), shown in minutes
  everywhere. Convert at the edge, for display only. Stored values do not change.
- `StartDialog.tsx:69`: drop the limits sentence.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DefinitionInspector.tsx:55` | Descendant tasks / Counts the whole tree, including nested follow-ups. Default 100; maximum 500. | Rewrite, `Field help` | **Most child tasks**, placeholder "100". Help: "Counts every task the run makes, however deep. Up to 500." |
| `DefinitionInspector.tsx:59` | Concurrent agents / Agents only. Waiting parents, gates, and data reads use no slot. Default 4. | Rewrite, `Field help` | **Agents at once**, placeholder "4". Help: "Only running agents count. Steps that wait or read data don't." |
| `DefinitionInspector.tsx:67` | Cost ceiling, in dollars | Rewrite | Cost limit in US dollars |
| `DefinitionInspector.tsx:71` | Wall clock, in milliseconds | Rewrite | Time limit in minutes (convert on save) |
| `DefinitionInspector.tsx:75` | Turns | Rewrite | Agent turns |
| `InputsInspector.tsx:56` | Required / Optional (a button) | Rewrite | `Checkbox` "Required" |
| `ScheduleDialog.tsx:308-310` | Maximum descendants / Maximum concurrent work / Maximum hours | Rewrite | The same labels as the Definition inspector, in minutes. |
| `StartDialog.tsx:69` | Up to {n} descendant tasks, four child levels, and {n} concurrent agents. Nested work shares these limits. | Remove | The limits live in the Definition inspector. |

Held with the required-field convention: `InputsInspector.tsx:41` ("Shown beside the box.") and
`FieldControl.tsx:88` ("Required."). The command step's timeout (a step blurb row) keeps its unit in
milliseconds and says so; do not convert it to seconds. The blurbs themselves are held (see
[deferred.md](../deferred.md)).

## What earlier batches give you

- **`Field help`** (K3), for the two limit explanations. `hint` stays the place for what to type.

## Risk and checks

- Before you start, find every place a stored limit is read, and convert only for display.
- Round-trip a value: set 90 minutes, save, reload, and read 90 minutes back.
- The start and schedule dialogs are B07b's surfaces too. Check them after this change.
- Screens: Definition with limits, Inputs, the start dialog with an input, the schedule dialog.
- Tests: `plugins/workflows` (`draft`, schedule tests).
