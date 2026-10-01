# 07-17. Text buttons 11 pixels high, a typed "+", and a code action row on the edge

**Status:** done 2026-10-02 on `more-ui`. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Workflows has eight bare text buttons about 11 pixels high: **Delete** in the outline header,
**Format** and **Revert** on the Code tab, **Reset** on a gate field, **Remove** on an input, a schema
field, and a branch, **Remove condition**, and **Clear structured output**. **+ Add** and **+ New**
type their plus. The Code tab's **Apply / Format / Revert** row sits flush on the column's edge, and
**Apply**, the one action that changes the draft, is outline. The outline header crowds five controls
into 300 pixels beside a label the tab already says.

## Where to see it

Workflows › a definition › the outline header; the **Code** tab; Inputs with one input; an agent step
with a result schema; an If step with a condition.

## Already done

- K1a gave a bare text button that is a direct child of a toolbar or an action row a 26 height. Bare
  buttons alone in a body are still 11 high.

## The fix

- `plugins/workflows/src/client/editor/NodeList.tsx:114-126`: delete and move leave the outline header
  for the inspector header ([07-6](./07-6-inspector.md)). The header keeps **Add step** with
  `Icon name="plus"`, and its label becomes **Steps**.
- `JsonTab.tsx:105-109`: **Apply**, **Format**, and **Revert** in a `Toolbar size="sm"` above the
  editor, with **Apply** solid.
- The bare text buttons (the gate field's Reset, Remove on an input, a schema field, and a branch,
  Remove condition, Clear structured output) become `IconButton` with a tip in chrome, or ghost xs or
  sm in a body.
- Typed "+ Add" and "+ New" use `Icon name="plus"`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `NodeList.tsx:130` | Outline | Rewrite | Steps (the tab already says Outline) |
| `NodeList.tsx:89` | + Add | Rewrite | **Add step**, with `Icon name="plus"` |
| `SchemaFieldEditor.tsx:91` | Clear structured output | Rewrite | Remove all fields |

The run footer's **Refresh** is B07b's ([07-13](../b07b-workflow-runs/07-13-run-pane-controls.md)).
`JsonTab.tsx:69`'s success line is 07-21j, also B07b's.

## Risk and checks

- Before you start, grep `plugins/workflows/src/client/editor/` for `variant="bare"` to find every
  bare button.
- Screens: the outline header, the Code tab, Inputs, a result schema, and an If condition.
- Tests: `plugins/workflows` (`WorkflowEditor.test.tsx`, `NodeList`).
