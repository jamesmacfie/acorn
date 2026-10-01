# 07-13. The run pane puts its controls in three places, and its footer is a label

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

An agent step puts **Kill step**, **Retry**, and **Show in Agent pane** in its header. Every other step
kind puts them at the bottom of the body, so **Retry** on a failed command sits under the output, 250
pixels below the header. The footer is a plain sub heading, 26 high with no bar or divider, reading
"failed · Tree usage · $0.12 · 3 turns · 1,234 input · 567 output", with **Cancel run tree** or an
11-high **Refresh**. **Nodes** is a group header holding a segmented control, which makes it 40 high.
The error alert has no tone, and a failed step's title says "This node stopped".

## Where to see it

The run pane on **Plan follow-up work**: select the failed command step, then the gate.

## Already done

- K1a gave **Cancel run** its armed label, "Cancel run?".
- K2's P11 draws a divider on top of a list footer.
- K4b made the dialog **Cancel**s ghost.

## The fix

- `plugins/workflows/src/client/runs/NodeDetail.tsx:266-362`: every step's controls go in its header
  `Toolbar` at sm, the way the agent shape already does (`:367-377`). A gate's **Approve** and
  **Reject** stay under the form ([07-14](./07-14-gate-form.md)).
- `runs/RunPane.tsx:161-196`: the footer becomes a `Toolbar size="sm"` in the list footer, reading
  status, cost, and turns. **Cancel run** is a ghost danger `ConfirmButton`. **Refresh** is
  `IconButton icon="refresh-cw"`.
- `RunPane.tsx:82-97`: **List / Graph** goes in the list header's actions. **Steps** is a plain group
  label.
- Elapsed time keeps counting from `createdAt`. A `startedAt` on the step row is deferred.
- `NodeDetail.tsx:174-175`: the error `Alert` gets a tone, and its title follows the step's status.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `RunPane.tsx:28` | Runs | Keep | |
| `RunPane.tsx:51` | No runs on this task. | Keep | |
| `RunPane.tsx:96` | Nodes | Rewrite | Steps |
| `RunPane.tsx:91` | Rows / Graph | Rewrite | List / Graph |
| `RunPane.tsx:182` | Cancel run tree | Rewrite | Cancel run |
| `RunPane.tsx:189` | Tree usage / Run usage | Remove | |
| `runDisplay.ts:49-50` | {n} input · {n} output | Rewrite | {n} tokens in, {n} out |
| `NodeDetail.tsx:175` | This node stopped | Rewrite | The title follows the step's status, for example "This step failed". |
| `NodeDetail.tsx:204` | Kill step | Rewrite | Stop step |
| `NodeDetail.tsx:215` | Retry with edited prompt | Rewrite | Edit prompt and retry |
| `NodeDetail.tsx:184` | Show in Agent pane / Open in Agent pane | Keep | |
| `NodeDetail.tsx:194, 200` | Open in terminal / Open terminal | Keep | |
| `NodeDetail.tsx:256` | This step is still working. A turn you send now runs after it finishes, by which time the run has moved on. | Rewrite | This step is still working. A message you send now runs after it finishes, once the run has moved on. |
| `NodeDetail.tsx:263-264` | This step has not started yet. / This step runs headless, outside a managed session, so there is no transcript. Its output is under Step details. | Keep first, rewrite second | / This step ran without a conversation, so there's no transcript. Its output is under Step details. |

The plan's overrule on rows 930 and 931: the footer uses row 931's wording ("tokens in, out") and
drops row 930's "Tree usage".

## What earlier batches give you

- **`ConfirmButton`** keeps its resting width when armed (K1a). The prompt is "{Verb} {thing}?".
- **Bars in a list footer** (K2's P11): the footer draws `--chrome-divider` on top, and a toolbar at
  the top of its stack drops its bottom rule.

## Risk and checks

- Before you start, list every step kind's control set in `NodeDetail.tsx`.
- A driver `click` on an armed `ConfirmButton` may not confirm; a scripted `.click()` does.
- Screens: the run pane with a failed command step, a waiting gate, and the graph view.
- Tests: `plugins/workflows`.
