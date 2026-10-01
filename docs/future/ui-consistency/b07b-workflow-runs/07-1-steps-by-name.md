# 07-1. The run pane lists steps by their internal id

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The run pane's step rows read `c25f2284-66ea-4704-8ebe-bc3d5…` while the detail header beside them
says **Approve the release**. Rows print the stable step id since steps gained ids, and the editor's
list maps the id back to a name but the run pane does not. The same id leaks into the row's "Waits on"
tip. The step list is how you find the step that failed, so every run is unreadable.

## Where to see it

The task **Plan follow-up work** has a failed run of **Release check**. Open the task, then the
**Workflows** pane, and read the step list in **List** view. If the Workflows pane does not show in
the switcher (B02 saw it vanish after restarts), start a run from the editor's **Run…**.

## The fix

- `plugins/workflows/src/client/runs/runPaneModel.ts:29-35, 104-121`: `RunNode` gains `label`:
  `step?.name ?? def.steps.find(s => stepIdentity(s) === row.name)?.name ?? row.name`, and parent
  labels to go with it.
- `runs/RunPane.tsx:149`: draw `node().label`.
- `RunPane.tsx:120`: the "Waits on" tip uses parent labels.
- `runs/RunGraph.tsx:27`: use `label`.
- `editor/NodeList.tsx:169`: the outline row's tip leaks ids the same way. Fix it too.
- Add a `runPaneModel.test.tsx` case where a step's id and name differ.

## Copy

No copy rows. The visible change is names in place of ids.

## Risk and checks

- Before you start, confirm the frozen definition is reachable from the run pane model.
- Screens: the run pane in List and Graph views, and the outline row's tip in the editor.
- Tests: `plugins/workflows` (`runPaneModel.test.tsx`).
