# 07-9. Outline rows are five lines tall, and a straight chain becomes a staircase

**Status:** not started. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Each step row in the editor's outline is compact density, 30 high, but holds the name, a two- or
three-line summary, and the "After" line, so rows measure about 90. The kind icon centres on the whole
row, level with the summary rather than the name. Rows indent by rank, so in a straight chain every
step moves 12 further right: a 10-step chain loses 120 of the column's 300 pixels. Five steps fill
the column.

## Where to see it

Workflows › any definition with three or more steps › **Outline** tab.

## The fix

- `plugins/workflows/src/client/editor/NodeList.tsx:161-186`: two lines per step, the name and then
  one muted line (the kind label or a step-specific summary, per [07-8](./07-8-say-it-once.md)).
  `variant="stacked"`, with the icon on the first line.
- `NodeList.tsx:166`: indent only a step that is a branch target or waits on more than one step. A
  chain stays flush. Keep `graphOrder` for the order.
- The run pane shares the indentation on purpose (`plugins/workflows/src/client/runs/runPaneModel.ts:101-103`).
  Change the rule in `graphOrder` or in both lists, not one.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `NodeList.tsx:119` | Remove {n} references? / Delete it? | Rewrite | "Delete step?", and when other steps use it, "Delete step? {n} steps use it." K1a already changed "Delete it?" to "Delete step?"; add the count back. |
| `NodeList.tsx:194` | No steps yet. Add the first one above. | Rewrite | No steps yet. Add one to start. |
| `NodeList.tsx:199` | Deleting this step affects {labels}. | Rewrite | Deleting this step also changes {step names}. |

## Risk and checks

- Before you start, check how `graphOrder` computes depth, and whether the run pane reads the same
  value.
- The rows sit in the outline list. Do not change row geometry beyond the two lines.
- Screens: the outline for a chain and for a workflow with an If; the run pane's step list
  afterwards.
- Tests: `plugins/workflows` (`NodeList`, `runPaneModel.test.tsx`).
