# 07-14. The gate approval form: small buttons, a raw field name, and loose problems

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The gate form in the run pane follows the page-flow placement (actions under the form, left), which is
right. The rest is not. **Approve** and **Reject** are sm in a page body, and **Reject** fails the run
with one press. A field's label is its name, `version`, because the inputs editor has no **Label**
field. The description is a separate line 8 below the input, not the field's hint. Problems are one
muted line joined with spaces. The input is about 1,000 pixels wide for a version number. The waiting
time freezes, because the clock ticks only while a step runs.

## Where to see it

The run pane on a task whose run is waiting at a **Wait for a person** step with a form. Start
**Release check** on **Plan follow-up work** to reach it, and cancel the run after.

## The fix

- `plugins/workflows/src/client/runs/NodeDetail.tsx:499-500`: **Approve** and **Reject** at md.
  **Reject** is a `ConfirmButton variant="ghost" tone="danger"` with "Reject?".
- `NodeDetail.tsx:483`: the description is the field's `hint`.
- `NodeDetail.tsx:493-497`: each problem is that field's `error`. `TypedValueField` takes `hint` since
  B07a ([07-15](../b07a-workflow-editor/07-15-forms-agree.md)).
- Cap the form with `DetailColumn measure="page"` where it applies.
- `plugins/workflows/src/client/editor/InputsInspector.tsx:36-52`: add a **Label** field.
  `WorkflowInput.label?` already exists.
- `runs/runPaneModel.ts:96`: tick the clock while a gate waits (`|| status === 'waiting-gate'`).
- The **Edited** badge and **Reset** stay where they are, with **Reset** as ghost xs. Moving them onto
  the label line needs a `Field` label accessory, which is deferred (see [deferred.md](../deferred.md)).

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `NodeDetail.tsx:308` | Waiting for you. | Keep | |
| `NodeDetail.tsx:450` | Approved without asking, because the run is autonomous. | Rewrite | Approved on its own, because this run skips approvals. |
| `NodeDetail.tsx:465` | Check these values, correct any that are wrong, then approve. | Keep | |
| (new) | Reject (one press) | Rewrite | A `ConfirmButton` armed as "Reject?" |

## What earlier batches give you

- **`DetailColumn measure="page"`** (K2's P13).
- **`ConfirmButton`** names its verb (K1a).
- **`TypedValueField` `hint` and `size`** (B07a, once it lands).

## Risk and checks

- Before you start, confirm B07a gave `TypedValueField` its `hint`.
- Screens: the gate waiting, the gate with an edited value, and the gate approved.
- Tests: `plugins/workflows` (`runPaneModel.test.tsx` for the clock).
