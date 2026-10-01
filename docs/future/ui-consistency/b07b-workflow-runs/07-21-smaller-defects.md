# 07-21. Smaller workflow defects

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Nine small defects across the editor, the run pane, and notifications. Each is local and small. Item
c, two fixed branch rows for an If step, is a new feature and is deferred (see
[deferred.md](../deferred.md)).

## Where to see it

The editor (add steps, open a committed file, the Code tab), the run pane (no step selected, a For each
run's records, child run cards), and the bell after a run.

## The fix

- **a.** `plugins/workflows/src/client/editor/draft.ts:84` names a new step after its kind's label
  ("Run a command"), numbered if repeated, not the kind id (`command`, `gate-human`).
- **b.** `outlineModel.ts:33` reads "No condition yet.", with no "If " prefix at `:58`.
- **d.** The env hint at `plugins/terminal/src/server/workflowSteps.ts:33` says "committed" only for a
  repo workflow. Check first that field hints do not feed the authoring prompt. If they do, leave it
  with the held step blurbs.
- **e.** The header of a committed file says "File in the repository", so the reader knows
  **Publish…** changes the working tree.
- **f.** `runs/NodeDetail.tsx:267` is a centred `EmptyState` with a title.
- **g.** `runs/RunRecords.tsx:207-338` keeps status, source, and times visible. The rest goes under
  **Details**.
- **h.** `runs/RunRelationships.tsx:16, 23` shows names, not ids.
- **i.** The notification text in `plugins/workflows/src/server/runs/runner.ts:555-558` and
  `server/steps/execution.ts:249`.
- **j.** `editor/JsonTab.tsx:69` says "Applied.".

## Copy

| Item | Where | Current text | Decision | New text |
| --- | --- | --- | --- | --- |
| b | `outlineModel.ts:33` | Choose a field and comparison. | Rewrite | No condition yet. |
| f | `NodeDetail.tsx:267` | Pick a node to see what it is doing. | Rewrite | Title "No step selected", body "Choose a step to see what it's doing." |
| | `NodeDetail.tsx:288` | The original task is missing or archived. Its selected record history remains retained on the Node. | Rewrite | The original task is archived or gone. Its record history is still here. |
| | `NodeDetail.tsx:290` | Back to selected record | Keep | |
| | `NodeDetail.tsx:530, 557-619` | Working. … / Nothing said yet. / cut short / Starting… / … | Keep | |
| g | `RunRecords.tsx:207, 208` | Record history / Loading records… | Keep | |
| g | `RunRecords.tsx:212` | {pluginId} · {sourceId} / Structured records | Rewrite | The source's display name / Records |
| g | `RunRecords.tsx:261` | Load next 100 | Rewrite | Show more |
| g | `RunRecords.tsx:269-279` | Decision / Source revision / Saved query {id} · revision {n} / Completeness / Evaluated / Read | Rewrite | Keep Status, Source, Evaluated. Fold the rest under **Details**. |
| g | `RunRecords.tsx:280, 281, 283` | Short result / Frozen input / Declared outputs | Rewrite | Result / Input / Outputs |
| g | `RunRecords.tsx:294` | The child task is missing or archived. Its run history is retained here. | Rewrite | The task is archived or gone. Its runs are still listed here. |
| g | `RunRecords.tsx:300` | Reprocess… | Rewrite | Run again… |
| g | `RunRecords.tsx:306` | This creates a new root attempt from the frozen input. It does not rerun the source query or restart successful siblings. | Rewrite | This runs the record again with the same input. Other records don't run again. |
| g | `RunRecords.tsx:307` | Create new attempt / Create this new attempt? | Rewrite | Run again / Run again? |
| g | `RunRecords.tsx:332` | More attempts | Rewrite | Show more |
| h | `RunRelationships.tsx:16` | Task unavailable ({taskId}) | Rewrite | Task archived or deleted |
| h | `RunRelationships.tsx:23` | Run retained; task unavailable ({runId}) | Rewrite | Its task is archived or deleted |
| h | `RunRelationships.tsx:81` | Retry reuses these tasks and runs. It does not create replacements. | Use the existing tip | The **Retry** button's tip already says it (K1a moved the sentence there). |
| h | `RunRelationships.tsx:103` | Approval required / Open the child run to review its gate. | Rewrite | Needs approval / Open the child run to approve it. |
| h | `RunRelationships.tsx:105` | Child run stopped | Rewrite | Child run failed |
| i | `runner.ts`, `execution.ts` | Workflow '{name}' finished | Rewrite | {name} finished |
| i | | Workflow '{name}' failed | Rewrite | {name} failed |
| i | | Workflow '{name}' completed with failures | Rewrite | {name} finished with failures |
| i | | Workflow '{name}' stopped at a safety rail. | Rewrite | {name} stopped at a limit |
| i | | Workflow '{name}' needs you: {step} | Rewrite | {name} needs you: {step} |
| j | `JsonTab.tsx:69` | Applied to the draft. Save to keep it. | Rewrite | Applied. |

Row 977's wording ("{name} needs you") is the plan's overrule, to match the **Needs you** status word.
K1a already gave the record history's confirmations their labels (**Retry attempt?**, **Start
attempt?**); the "Run again?" row above replaces **Start attempt?** if the button is renamed.

## What earlier batches give you

- **`pluginLabel`** (K5). K5 noted `RunRecords.tsx:41` still prints a plugin id.

## Risk and checks

- Before you start, check item d against the authoring prompt builder
  (`plugins/workflows/src/server/authoring/`).
- Item i changes node-side text. Restart the node to see it in the bell.
- Screens: a new step's name, an If row, a committed file's header, the run pane with nothing selected,
  and the bell after a run.
- Tests: `plugins/workflows` (including `server/runs` tests for the notification text) and
  `plugins/terminal`.
