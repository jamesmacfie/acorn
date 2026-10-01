# 07-20. One idea, several words: step, node, root, posture, tree

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The list says "3 steps" and the menus say "Add a step", but the footer says "3 nodes · 1 roots" and the
run pane says **Nodes**, "Pick a node to see what it is doing.", and "This node stopped". Limits say
"descendant". The run footer says "Tree usage" and **Cancel run tree**. The style rule is one term per
concept: readers wonder whether a node and a step are different things, and "node" already means the
machine acorn runs on.

## Where to see it

The editor footer, the Definition inspector, and the run pane.

## The fix

Say **step** wherever a person reads it, "child" for descendants, and drop "roots" and "Tree usage".
Most of the strings live in other findings' copy tables, so this finding is a sweep:

- B07a carries **Approvals: Stop and ask / Skip** for posture and drops "The node's own profiles"
  ([07-6](../b07a-workflow-editor/07-6-inspector.md)), says **Make an editable copy**
  ([07-2](../b07a-workflow-editor/07-2-editor-header.md)), names the limits
  ([07-15](../b07a-workflow-editor/07-15-forms-agree.md)), and rewrites the footer
  ([07-10](../b07a-workflow-editor/07-10-problems-footer.md)).
- [07-13](./07-13-run-pane-controls.md) carries **Steps**, **Cancel run**, and the footer words.
- The rows below are the ones left.

After the sweep, grep `plugins/workflows/src/client/` for "node", "root", "descendant", and "tree" in
strings a person reads, and fix any left.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `plugins/workflows/src/client/runs/RunPane.tsx:140` | {n}/{m} children | Rewrite | {n} of {m} child runs done |
| `NodeDetail.tsx:247` | Runs on its own task. | Rewrite | Runs in its own task: |
| `NodeDetail.tsx:273, 367` | Workflow node (toolbar name) | Rewrite | Workflow step |
| `RunRelationships.tsx:37, 39` | Parent and root task / Parent task / Parent and root run / Parent run | Rewrite | Started by: {task}, {run} |
| `schedules/scheduleModel.ts:70` | {n} descendants · {n} at once · {n}h maximum | Rewrite | Up to {n} tasks, {n} at a time, {n} hours. Use minutes if 07-15 shows minutes everywhere. |

## Risk and checks

- Before you start, check which of the cross-referenced rows B07a already applied.
- Screens: the run pane, the editor footer, and a schedule's summary line.
- Tests: `plugins/workflows`. Search the tests for the old words; some assert them.
