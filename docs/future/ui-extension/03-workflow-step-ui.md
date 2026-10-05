# Phase 03: add workflow step renderers

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
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
