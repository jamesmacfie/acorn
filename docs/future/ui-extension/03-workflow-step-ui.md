# Phase 03: add workflow step renderers

Status: done, October 10, 2026. Branch `phase-03-workflow-step-ui`, from `6f105cb0b`.

## Completion note

The plugin that runs a step kind can draw that step's result in the run pane. Workflows keeps the
header, Stop, Retry, the error, lineage, child runs, events, gates, the agent conversation, and a
map's records outside the slot. HTTP draws its own `http:request` responses through a loaded tree
entry, and a loaded fixture drew a step kind Workflows has no code for. With every contributor off,
the pane draws exactly what it drew before.

### What landed

- **Contract.** `plugins/workflows/src/contract/stepBody.ts` holds `WORKFLOW_STEP_BODY_POINT`,
  `WorkflowStepBodyProps`, `MAX_STEP_BODY_JSON_BYTES` (64 KiB), and `MAX_STEP_BODY_TAIL_LINES` (200).
  Props are `{ taskId, projectId, runId, stepId, kind, status, inputs, inputsTruncated, output,
  outputTruncated, tail?, revision }`.
- **Point.** `workflows:step-body`, `remote`, `replace`, `max: 1`, no actions, registered in
  `plugins/workflows/src/client/index.ts`. The key is the step's exact kind.
- **Projection.** `runs/stepBodyProps.ts` is one pure function. `inputs` is the parsed `inputsJson`,
  `output` the parsed `structuredJson`. Each is `null` when absent, when it doesn't parse, or when its
  stored text is over 64 KiB, and only the last case sets the flag. `tail` is the newest 200 lines of
  the model's tail, which the model already caps at 4,000 characters.
- **Owner.** `NodeDetail.tsx` wraps the non-gate body in `Slot`, with every built-in body (command,
  run target, data, HTTP, the agent summary, and the generic JSON) as its default. Under a contributed
  body, the pane says when inputs or output were over 64 KiB and the plugin got none.
- **HTTP.** `plugins/http/src/tree/StepBody.tsx` is a `stepBody` entry in the existing tree bundle,
  declared in `acorn-plugin.config.mjs` with `matches: ["http:request"]`. It draws a status badge,
  headers under a fold, the body laid out when it's JSON, and **Copy body** through its own bridge. It
  reads only its props, keeps no module state, and checks the output's shape before drawing it.
- **Discovery and docs.** The `plugin_authoring` brief names the point. [Contributed step
  bodies](../../workflows/routes-and-ui.md#contributed-step-bodies) owns the contract, with a table
  row in [remote points](../../plugins/remote-points.md) and a paragraph in
  [the HTTP client's workflow step](../../http-client.md#the-workflow-step).

### Decisions and deviations

- **`revision` counts the projection's recomputes.** It rises on any change to the selected step's
  row or to the model's tail record, so it can rise with no visible change. A lower number is always
  stale, which is the promise providers need.
- **`projectId` is a string, not nullable.** A `Task` always has one.
- **`output` is `structuredJson` only.** That's what every built-in body and the generic fallback
  draw. `resultJson` (an HTTP step's URL and duration, a command's duration) isn't passed.
- **A map's records stay outside the slot.** They're relationships, with navigation the pane owns.
- **The agent summary is replaceable.** With the agents plugin off, an agent step's summary is an
  ordinary body. The live conversation branch never opens the slot.
- **Tree failure falls back for free.** Phase 01's `Slot` change covers it, and a test drives it
  through the real `RemoteTree` with a bundle the client can't load.
- **Automated tests use compiled contributors,** as phases 01 and 02 did, because a plugin test may
  not mock client-core. The loaded fixture was a scratch plugin in `/tmp` with a node step kind
  `acme-step:deploy` that streamed 40 lines, and a tree that drew its status, revision, output URL, and
  tail. It isn't committed.

### Verification

Run with Node 26.8.1.

- `NodeDetail.test.tsx`: 27 tests, 10 new. They cover loaded replacement with Retry pressed outside
  the body, a kind Workflows has never heard of, no match, a tie, disabling the provider, malformed
  and oversize JSON, a running step updating in place with one mount and a rising revision, a 250-line
  tail cut to 200, a change of run and step, a late tail for the old step, a remount for a new Node, a
  waiting gate with a contributor matching `gate-human` that never mounts while Approve still answers,
  the agent conversation with a contributor matching `agent`, and a loaded tree failing. Breaking the
  key fails 7 of them, and hiding the oversize explanation fails its test.
- `StepBody.test.tsx`: 3 tests. The entry emits valid worker messages, two mounts don't share state, a
  props update redraws, and output that isn't a response is refused.
- `pnpm test` for `@acorn/plugin-http` (152), `@acorn/node-core` (169 files), and `@acorn/client-core`
  (343 files): all pass. `@acorn/plugin-workflows`: 638 of 639. The failure,
  `generate.test.ts > falls back to one line a kind, and never fewer kinds`, fails the same way on an
  untouched tree.
- `@acorn/tui`: 71 of 72 files pass. The failures are the two known `chrome.test.tsx` task-marker tests.
- `pnpm --filter @acorn/arch-tests test`: only the known `docPaths` failure, 15 links. `remote-points.md`
  stays at 200 lines.
- `pnpm lint`: oxlint reports warnings only, none in this phase's files. Turbo stops at the known
  `plugin-changes` type errors. Run directly, `tsc` is clean for `plugin-http` and `node-core`, and
  `plugin-workflows` fails only on `workflowMapLifecycle.test.ts(222)`, which predates this phase.
- **Desktop, `pnpm dev:agent`.** A throwaway repo and task, the scratch plugin installed and
  accepted. The trust prompt listed "Draw its own UI inside workflows’s “Deploy result”". A run with
  the custom step, an agent step, and a waiting gate:
  - The custom step drew through the loaded fixture. Watched live, its revision rose from 9 to 13 to
    18 while the 40 lines streamed into its tail, Stop stayed in the header, and the same mount went
    to done. Its output arrived when the run next re-read (see below).
  - HTTP steps couldn't run (see below), so two `http:request` rows were inserted into the run.
    The running one drew the HTTP plugin's "Sending…" with Stop in the header. The finished one drew
    the 201 badge, two headers in a fold, and the JSON body laid out.
  - The agent step drew its conversation unchanged. The gate drew its own Approve and Reject, and
    pressing **Approve** finished the run.
  - With `acme-step` and `http` disabled and the node restarted, the custom step drew the generic
    JSON, the HTTP step drew the pane's own status, headers, and body, and the gate kept its controls.
- **Terminal, `pnpm dev:tui:agent`.** The same plugin and a run on a fixture task. The trust overlay
  listed the grant. The Workflows pane drew the custom step's body through the loaded fixture in cells,
  and the waiting gate drew its own **[Approve] [Reject]**, which a key press approved. Not checked
  there: the HTTP body, because the standalone session doesn't install the HTTP plugin, and the
  fallback with the fixture disabled, because the driver couldn't move the step selection (see below).

### What later phases need to know

- **No `http:request` step can be published or started in this build.** Preparing a publication answers
  409 "Spread syntax requires ...iterable[Symbol.iterator] to be a function". The runner's
  `validateStepKind` returns a loaded plugin's `validate` result, and `validateWorkflow` spreads it,
  but across the plugin worker it isn't an array. It predates this phase, which changed no execution
  code. It needs its own fix in `plugins/workflows/src/server/runs/runner.ts` or the plugin host.
- **A step's output arrives late mid-run.** A finished step's status moves on a socket edge, but its
  row's `structuredJson` arrives only when the run next re-reads, such as at the run's end. Built-in
  bodies have the same gap. A provider sees `status: 'done'` with `output: null` for a while.
- **The terminal never starts client schedules,** so a task's Workflows pane appears there only after a
  start from that client. Its step list didn't take keyboard focus through the driver.
- A step handler's `emit` takes `{ at, event }`. A bare event shows up as `undefined` in the Events fold.
- For a point registered in code, the trust prompt still quotes the contributor's own label, as phases
  01 and 02 recorded.

## Original plan

Planned October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 02. This phase adds a cooperative body, not workflow execution behavior.

Let a step provider draw its own result and streamed detail UI while Workflows retains run controls,
status, relationships, retries, approvals, and the conversation layout.

## Starting point and scope

`plugins/workflows/src/client/runs/NodeDetail.tsx` selects fixed command, run-target, database, HTTP,
agent, gate, and generic bodies in `shapeOf`. It parses `structuredJson` and draws live tails.
`plugins/workflows/src/client/runs/NodeDetail.test.tsx` covers those owner views.
`plugins/workflows/src/contract/extensions.ts` and [step kinds](../../workflows/step-kinds.md) govern
execution contributions; UI must not change those semantics.

Read [workflow UI](../../workflows/routes-and-ui.md), [human gates](../../workflows/execution.md#human-gates),
and [remote points](../../plugins/remote-points.md).

## Contract

Workflows owns `workflows:step-body`, `remote`, `replace`, keyed by the exact step kind, such as
`http:request`. Pass `{ taskId, projectId, runId, stepId, kind, status, inputs, output, revision }`.
`inputs` and `output` are validated JSON projections of the selected step's stored data, not model
objects or callbacks. Include only data the owner body already exposes. Cap each serialized projection
at 64 KiB and supply explicit `inputsTruncated`/`outputTruncated` flags when it is omitted.

Pass a bounded `tail` only when the owner already has one, capped at 200 displayed lines and 64 KiB.
Providers needing more read their own Node records or a deliberately added read-only Workflows
capability. Do not expose the broad run-control bridge or turn a UI request into workflow execution.

No owner actions are declared in this phase. Workflows keeps Retry, Cancel, Skip, approval forms,
Approve/Reject, and task lineage outside any contributed body. Gates and the live agent-conversation
branch are excluded from replacement. Their details can gain a separate point when a caller needs it.

## Steps

1. Add the owner contract and client point registration. Wrap the ordinary non-gate, non-conversation
   result body in `Slot`, retaining every built-in body as fallback.
2. Project data in one typed function beside the run detail. Keep revision and selection identity
   explicit, retain the mounted worker on updates, and omit oversize fields with visible explanations.
3. Move HTTP result presentation into a loaded `http:request` contribution through the HTTP bundle.
   Give it only the props above and its own bridge. Use ordinary built-in HTTP rendering as fallback
   during migration, so disabling HTTP UI cannot blank stored workflow results.
4. Add a fixture for an unrecognized contributed step kind. Verify a provider can render it without
   importing Workflows client state or adding another branch to `shapeOf`.
5. Preserve fragment sizing for the embedded Agents conversation and the owner gate form. Check that
   contribution failure does not change status, approve a gate, or move the selected run.

## Tests and acceptance

Extend `NodeDetail.test.tsx` for loaded replacement, no match, ties, disabled provider, malformed and
oversize JSON, running updates, changed run/step/Node, and a response that arrives after navigation.
Verify Retry and approval behavior through user actions, including a waiting gate with a contributor
that tries to match its kind. No worker should start for that excluded body.

Run `pnpm lint`, full suites for `@acorn/plugin-workflows`, `@acorn/plugin-http`, `@acorn/client-core`,
and `@acorn/tui`, affected protocol/SDK suites, and `pnpm --filter @acorn/arch-tests test`.
Expect exit zero. In desktop and terminal sessions, inspect a running HTTP result, a custom step,
an agent conversation, and a waiting gate. Disable the contributor and confirm usable fallbacks.

Complete when one shipped provider and one loaded fixture fill the point, owner controls remain
reachable, and no provider-specific branch is required for the fixture's kind.

## Verify before building

- Recheck event and output shapes in the live run model before defining the projection.
- Confirm the HTTP tree bundle can register a second entry without state shared across mounts.
- Stop if the migration requires changing step execution, approval authority, or persisted results.
