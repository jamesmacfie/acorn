# 07-18. Workflow dialogs: Publish, Run, Schedule, and AI authoring

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Each workflow dialog has its own problem. Publish lists what it will write with raw ids. Run opens
with a limits sentence before the task picker, and its fields are sm. Schedule's timezone is free text
with an IANA hint, its next checks print seconds under a hand-built heading, and its body ends with a
sentence about node-side drafts. AI authoring has no footer, an unlabelled instruction box under two
unlabelled pickers, a **Send** in the body, and a diff described by JSON paths.

## Where to see it

Workflows › **Release check**: **Publish…**, **Run…** (the start dialog appears when an input is
needed), **Schedule…** from the overflow menu, and **AI authoring**. Do not press **Send** in AI
authoring: it calls a model. The dashboards Add panel dialog shares the AI authoring view.

## Already done

- K4b gave Publish a **Cancel** and moved **Discard review** to the leading ghost slot. It also set the
  start dialog's **Cancel** to ghost and the schedule dialog's buttons to ghost with a spacer.
- K4a gave every `Modal` a title id, a close button, and default focus.

## The fix

This is the partial fix. Schedule's seven buttons (moving **Run now**, **Pause**, and **Delete** out of
the footer) wait for a decision on where they live (see [deferred.md](../deferred.md)).

- **Publish** (`plugins/workflows/src/client/editor/WorkflowEditor.tsx:445-459`): list what will be
  written by name, without raw ids (`:449-451`).
- **Run** (`StartDialog.tsx:63-109`): md fields.
- **Schedule** (`plugins/workflows/src/client/schedules/ScheduleDialog.tsx`): the timezone becomes a
  searchable `Select`. The kit's `Select` grows a filter past `FILTER_FROM` options. The next checks
  drop seconds. "Next three checks" becomes `SectionHeader level="sub"`. The sentence at `:342` goes
  from the body (see the copy note).
- **AI authoring** (`packages/client-core/src/features/dataSources/AuthoringConversation.tsx:147-199`,
  shared with dashboards): the pickers come after the instruction, the instruction has a label,
  **Send** goes in `Modal.Actions` with **Close**, and a proposal's diff is described by step name.
- Delete `plugins/workflows/src/client/editor/GenerateModal.tsx` after moving `generateReason` out.
  `WorkflowEditor.test.tsx:7` imports it. Nothing else does.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `WorkflowEditor.tsx:445` | Publish workflow | Keep | |
| `WorkflowEditor.tsx:448` | Runs and schedules use the published revision. These definitions will be written: | Rewrite | Runs and schedules use the published version. Publishing saves: |
| `WorkflowEditor.tsx:449` | {name} · {kind} · revision {n} | Rewrite | {name}, version {n}. Say "saved query" only for a query. |
| `WorkflowEditor.tsx:450` | Also affects: {names} | Keep | |
| `WorkflowEditor.tsx:451` | Already published: {kind} {id} revision {n} | Rewrite | Already published: {name} |
| `WorkflowEditor.tsx:456-457` | Discard review / Publish / Resume publishing | Keep | |
| `WorkflowEditor.tsx:462` | Export to repository / Publish to file | Keep | |
| `WorkflowEditor.tsx:465` | These files will be written to the working tree and left uncommitted. Files already in the workspace are kept. | Rewrite | acorn writes these files into the project folder and doesn't commit them. The workflow here stays as it is. |
| `WorkflowEditor.tsx:466, 473` | Written: / Pending: {path} / Write files / Resume writing files | Keep | |
| `WorkflowEditor.tsx:481` | AI authoring · {name} | Rewrite | Edit {name} with AI |
| `StartDialog.tsx:64` | Run {name} | Keep | |
| `StartDialog.tsx:72` | The run happens in this task's checkout. | Remove | |
| `StartDialog.tsx:77` | Choose a task… | Keep | |
| `StartDialog.tsx:100` | This workflow asks for nothing. Pick a task and run it. | Rewrite | This workflow needs no inputs. |
| `ScheduleDialog.tsx:208` | Every unattended run creates its root task in this project. | Rewrite | Each scheduled run makes its task in this project. |
| `ScheduleDialog.tsx:236` | Calendar schedules and time windows use this IANA timezone. | Remove | The searchable `Select` replaces it. |
| `ScheduleDialog.tsx:242` | Next three checks | Keep | As `SectionHeader level="sub"`. |
| `ScheduleDialog.tsx:302-303` | The initial baseline records current matches without running child workflows. … / Current matches inside the workflow query window are eligible on the first check. | `Field help` on **First check** | Start tracking from now notes today's matches without running anything. Process current matches runs them on the first check. |
| `ScheduleDialog.tsx:305` | Effective limits | Rewrite | Limits |
| `ScheduleDialog.tsx:317` | Existing processing history is retained, so unchanged records do not run again. | Rewrite | Records that already ran won't run again unless they change. |
| `ScheduleDialog.tsx:325` | Start fresh / Creates a new processing history. Matching records may run again; old attempts remain available. | Rewrite | Start fresh / Forget which records already ran. They may run again. Past runs stay in history. |
| `ScheduleDialog.tsx:342` | Saving keeps this draft on the Node. Activation is a separate device action and is never queued while offline. | Remove from the body | Keep the fact "never queued while offline" where the person activates, for example as **Activate**'s tip: "Activation never waits in a queue while you're offline." |
| `ScheduleDialog.tsx:335, 340, 357` | Open run / Open run to cancel / Reconnect in Settings / Approve changes / Activate | Keep | |

The plan has two instructions for `:342`: the 07-18 fix drops the sentence, and copy row 913 keeps
"never queued while offline". The resolution above does both. The limit labels in the schedule dialog
are B07a's [07-15](../b07a-workflow-editor/07-15-forms-agree.md).

## What earlier batches give you

- **The dialog shape** in `docs/ui-design.md` § Chrome and overlays (K4b). See
  [house patterns](../house-patterns.md#dialogs).
- **`Field help`** (K3).

## Risk and checks

- Before you start, read the hazard on dismissed publications in the
  [README](../README.md#hazards-in-the-running-app). Pressing **Cancel** on Publish leaves a prepared
  publication.
- `AuthoringConversation.tsx` is shared with the dashboards editor. Shoot the Add panel dialog too.
- The `Select` filter is a kit change. Check the terminal host still draws a long select.
- Screens: Publish, Start, Schedule, and AI authoring.
- Tests: `plugins/workflows` (`WorkflowEditor.test.tsx` after the import moves), the client-core
  dashboards tests, and `pnpm --filter @acorn/tui test` if `Select` changes.
