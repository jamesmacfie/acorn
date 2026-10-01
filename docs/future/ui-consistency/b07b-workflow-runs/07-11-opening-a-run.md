# 07-11. After Run…, nothing says where the run went, and the rail's run rows go nowhere

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

After **Run…** the start dialog closes and the editor stays put, with no toast or link. Pressing a run
under **Recent runs** changes the address to the task's run, but the shell draws what the rail source
says, not the address. You stay on Workflows, the project picker empties, and the list says "Choose a
project to see the workflows it can run." The schedule dialog's **Open run** does the same. You start
a run and cannot find it.

## Where to see it

Workflows rail › **Recent runs** › press a run. Also the editor's **Run…**, and **Open run** in the
schedule dialog.

## The fix

- `plugins/workflows/src/client/runs/runStore.ts`: add `openWorkflowRun(task, runId, navigate)`. It
  calls `rememberWorkflowRun`, then `activateTaskSignals(task, { pane: 'workflows' })`, then navigates
  to `?pane=workflows&item=`, the way
  `plugins/agents/src/client/center/AgentCenter.tsx:180-186` opens a session. `activateTaskSignals` is
  already public.
- Call it from `WorkflowsBrowse.tsx:149-155` (`openRun`), `schedules/ScheduleDialog.tsx:168-175`, and
  as the default `onStarted` in `editor/startRequest.ts`. The editor's `run()`
  (`WorkflowEditor.tsx:228-234`) passes no `onStarted`, and the direct-start path needs it too.

## Copy

No copy rows.

## Risk and checks

- Before you start, read `AgentCenter.tsx` to copy its order of calls exactly.
- This changes navigation from three places. Open a run from each one.
- **Run…** starts the workflow at once when it has no inputs, with no start dialog. K4b's agent started
  a real run this way. Cancel any run you start.
- Screens: the rail after opening a run, and the run pane it lands on.
- Tests: `plugins/workflows`.
