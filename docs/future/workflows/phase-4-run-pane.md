# Phase 4: the run pane, and the links in both directions

Status: not started. Waits on phase 0. Reads phase 3's list rendering when it exists.

## Goal

A task with a run has a Workflows pane: runs, nodes, each node's live progress by kind, and the
controls that are legal for its state. An agent node opens its session in the Agent pane; the Agent
pane names the workflow that started a session and opens the run. Every bell row for a workflow lands
on the node it is about. The sidebar's step rows go.

## Why this phase, and why now

Every other surface points here. The palette's "find a run" was deferred because there was nowhere
to open one; the notice has no target for the same reason. Once this pane exists, each of those is a
one-line change.

## Scope

In: the pane and its model, per-kind node detail, controls, live updates, the pane intent, the deep
link, the attention source, the notice target handler, the `run-failed` notice, the agent pane chip,
the sidebar glyph, the sidebar cleanup, the palette's "Find a run", the rail's recent runs opening
the pane, as [05-ui.md](./05-ui.md) § The run pane and § The agent pane specify.

Out: the editor, the item menu, the canvas.

## Design detail

**Pane.** `plugins/workflows/src/client/runs/paneContribution.ts` (new): id `workflows`, `list-detail`,
`when: (task) => runsForTask(task.id).length > 0`, `model: (task) => createRunPaneModel(task)`.
Regions from `RunPane.tsx` (new): list header (count), list (`RunList` then `NodeList`), detail
(`NodeDetail`). The node list reuses phase 3's graph ordering and depth from `editor/draft.ts`, which
is why it is pure.

**Model.** `runPaneModel.ts` (new): runs and steps as resources over `WORKFLOW_CONTROL`, the
selected run and node, the per-step event tail (last 200 events, last 4 KB of stdout), subscriptions
to the three frames, and the actions (`gate`, `cancel`, `kill`, `retry`). `WORKFLOW_CONTROL` gains
`retry(runId, stepId, prompt?)`, `runForSession(sessionId)`, and `run(runId)`.

**Node detail.** `NodeDetail.tsx` (new) dispatches on kind and status per the table in
[05-ui.md](./05-ui.md). Agent detail reads the session's last assistant text from
`managedAgentStore` when the session is loaded and from the step's `resultJson` otherwise. Command
detail draws the tail from the model. Data detail draws a kit `Table`. Controls call the model's
actions and disable while in flight.

**Intent and deep link.** `PaneIntent` in
`packages/client-core/src/host/registries/commands/clientEvents.ts` gains `{ kind:
'workflows:show-run', runId, stepId? }`. The pane consumes it on mount and on change. The deep link
`?pane=workflows&item=<runId>` maps to the intent in the pane's own `item` handling, as other panes
do with `plugin:select`.

**Notices.** `initWorkflowNotices` in `packages/client-core/src/features/notifications/deliver.ts`
builds `target: { kind: 'workflow-run', resourceId: runId, subresourceId: stepId }` when the frame
carries `runId`. `plugins/workflows/src/client/index.ts` registers
`registerNoticeTargetHandler('workflow-run', …)` that calls `openPane` with the intent.

**Attention.** `plugins/workflows/src/client/runs/attentionSource.ts` (new): `fetch(nodeId)` reads
gated runs on that node and returns one `warn` row per waiting gate with id
`workflow:gate:<stepId>`, `at` the step's `updatedAt`, the target above.

**Agent pane.** `AgentDetailHeader` in `plugins/agents/src/client/sessions/AgentPane.tsx` reads
`session.kind === 'workflow'` and `session.config.workflowRunId`, asks `WORKFLOW_CONTROL.runForSession`,
and draws the chip. `AgentTaskSidebar.tsx` drops the "Terminals and workflows" section and its
`workflowData` resource; the session row gains the glyph. `buildRoster` in `sessions/model.ts` loses
its step parameters, and `stepFeed` and `resumeCommandFor` move to the workflows plugin or are
deleted, since the run pane opens sessions rather than resume terminals. The `resumeCommand` field on
`WorkflowStepRow` stays for a step with only a provider session id, which the run pane offers as
"Open in terminal" the way the sidebar did.

**Palette.** `commands.ts` gains "Find a run".

**Rail.** The source's recent runs open the task with the deep link.

## Code touched

- `plugins/workflows/src/client/runs/` (new folder): `paneContribution.ts`, `RunPane.tsx`,
  `runPaneModel.ts`, `NodeDetail.tsx`, `attentionSource.ts`.
- `plugins/workflows/src/client/index.ts`: the pane, the attention source, the target handler, the
  capability's new members.
- `plugins/workflows/src/client/commands.ts`: "Find a run".
- `plugins/agents/src/contract/workflowControl.ts`: three members.
- `plugins/agents/src/client/sessions/AgentPane.tsx`, `AgentTaskSidebar.tsx`, `model.ts`.
- `packages/client-core/src/host/registries/commands/clientEvents.ts`: the intent.
- `packages/client-core/src/features/notifications/deliver.ts`: the target.
- `packages/client-core/src/infra/node/wsClient.ts`: `workflow:step-changed` dispatch.
- `apps/desktop/test/client/parity.snapshot.json`, `clientPluginDisable.snapshot.json`.

## Tests

- `plugins/workflows/src/client/runs/runPaneModel.test.ts` (new): a `step-changed` frame updates one
  node's status without a refetch; `run-changed` refetches; the tail keeps the last 4 KB; the
  selection follows an intent.
- `plugins/workflows/src/client/runs/NodeDetail.test.tsx` (new): per status, the controls drawn
  match the table, and a done node draws none; an agent node's button calls `openManagedSession`
  with the step's `agentSessionId`.
- `plugins/workflows/src/client/runs/attentionSource.test.ts` (new): ids are stable across fetches and
  carry no timestamp; a resolved gate stops appearing.
- `packages/client-core/src/features/notifications/deliver.test.ts` (extend): a frame with `runId`
  yields a notice with the `workflow-run` target; one without keeps no target.
- `plugins/agents/src/client/sessions/AgentPane.test.tsx` (new or extended): the chip appears for a
  workflow session and not for an interactive one.
- The notifications invariants suite still passes.

## Docs owed

`docs/workflows.md` § Routes and UI (the pane, controls, live frames) and § From the command palette
("Find a run" reopened, the deferral paragraph deleted); `docs/panes.md` (the pane list gains
workflows); `docs/notifications.md` § What a row points at (`workflow-run`, the gate row);
`docs/managed-agents.md` (the chip; `kind: 'workflow'` is read); `docs/testing.md` smoke items.

## Doors left open

- A rendered-prompt view per node, from `inputsJson`.
- An "Open child task" that also selects the child's pane. The link opens the task today.
- The graph view of a run is phase 6.

## Done when

- Starting the owner's first workflow from a file, the pane appears on the task, both investigators
  show running at once, each opens in the Agent pane and the Agent pane's chip comes back, the gate
  rings and the bell row lands on the gate node, Approve finishes the run, and a forced failure
  offers Retry and recovers.
- The agents pane draws no workflow step rows anywhere.

## Verify before building

- `plugins/agents/src/client/sessions/AgentTaskSidebar.tsx` still draws "Terminals and workflows".
- `WORKFLOW_CONTROL` in `plugins/agents/src/contract/workflowControl.ts` still has `runs`, `steps`,
  `gate` only.
- `initWorkflowNotices` in `deliver.ts` still passes no `target`.
- `AgentDetailHeader` is still in `plugins/agents/src/client/sessions/AgentPane.tsx` and
  `session.config` is reachable there.
- `PaneCommon.when` still gates a pane per task, and the switcher hides a pane whose `when` is false.
- The `workflow:` prefix is still registered in `wsClient.ts` and dispatches by full channel name.
