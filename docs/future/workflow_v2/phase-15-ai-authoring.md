# Slice 15: Contextual AI discovery and proposal review

Date: 2026-09-20. Status: implementation complete; real-backend acceptance pending.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ai-authoring.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 10, 12, 13, 14. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

AI authors the same query/workflow/dashboard definitions as the visual editor using real source metadata.

## Work

1. Add bounded feature-owned authoring conversations and the metadata-request/clarification/proposal response loop.
2. Route validated discovery/describe/options requests to the shared data service and keep API/CLI text backends supported.
3. Add explicit sample opt-in, bounded selected preview samples, cancellation, usage reporting, and recoverable pending questions.
4. Validate candidates with the same feature validators; show semantic diffs and apply one undoable edit after review.
5. Reconcile stale proposals against draft revisions and expose read-only discovery through the existing agent-tool/MCP projection with ordinary scope checks.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Use fake model sequences for real option lookup, ambiguity, invalid field/operator, dropped-filter refusal, repair limits, cancellation, opt-in samples, prompt-injection-like record content, and stale draft changes. Repeat the three examples with a real configured backend.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Implemented on 2026-09-20. The implementation adds one bounded conversation protocol shared by API
connections and text-only harnesses. Query, workflow, and dashboard editors keep their own apply and
validation paths. The Node source runtime remains the authority for source listing, dynamic
discovery, descriptions, options, and opted-in previews. The existing agent-tool registry projects
the read-only source tools to MCP.

Automated checks:

- `pnpm --filter @acorn/protocol test src/authoring.test.ts`: 14 tests passed. Each backend adapter
  case covers real option lookup, inline clarification, invalid field and operator repair, malformed
  reply limits, dropped-filter refusal, metadata limits, untrusted record content, cancellation,
  context bounds, and stable-ID diffs.
- `pnpm --filter @acorn/plugin-workflows test src/server/workflowAuthoringConversation.test.ts
  src/client/editor/WorkflowEditor.test.tsx src/server/generateWorkflowRequest.test.ts`: 33 tests
  passed. The suite covers both backend IDs, dynamic source discovery, child workflow metadata,
  sample opt-in and omission, review, apply, reject, undo, cancellation, and navigation recovery.
- `pnpm --filter @acorn/node-core test src/server/routes/authoring.test.ts
  src/server/dataSources/runtime.test.ts src/server/routes/plugins/agentTools.test.ts`: 36 tests
  passed. The suite covers the device-only route, source authority, and agent-tool projection.
- `pnpm --filter @acorn/node-core test src/server/modelProviders/runtime.test.ts
  src/server/modelProviders/harnessRuntime.test.ts`: 17 tests passed across the API connection and
  text-only harness adapters used by the shared authoring loop.
- `pnpm --filter @acorn/node test test/integration/coreTools.test.ts`: four tests passed, including
  the task-scoped, read-only source metadata tool set assembled when host bindings are present.
- `pnpm --filter @acorn/client-core test src/features/dataSources/authoringMerge.test.ts
  src/features/dataSources/SourceQueryEditor.test.tsx
  src/features/dashboards/dashboardEditorModel.test.ts`: 11 tests passed.
- `pnpm --filter @acorn/plugin-api test src/surface.test.ts src/entrypoints.test.ts
  src/dataContracts.test.ts`: 12 tests passed after updating the additive public-surface snapshot.
- `pnpm --filter @acorn/arch-tests test boundaries.test.ts`: 52 tests passed.
- Targeted TypeScript lint passed for protocol, Node core, client core, plugin API, workflows, the
  Node composition root, and architecture tests. Targeted `oxlint` found no phase-15 errors.

The real-window provider-backed matrix remains pending. `pnpm dev:agent -- --session
workflow-v2-phase15 --reuse` built and launched the debug app, and the service reached `ready` at
`https://127.0.0.1:55064`. Both `snapshot` attempts returned no text or elements, and
`phase15.png` was a blank white renderer. The session log also reported that the isolated database
and Linear plugin bundles could not import `node:module`. The session was stopped with
`pnpm dev:agent:ui -- --session workflow-v2-phase15 stop`; no UI or provider result is claimed.

Repeat the matrix on a working renderer with a configured API backend and signed-in text-only
harness. Cover workflow, query, and dashboard proposals, clarification, sample opt-in, apply, reject,
undo, navigation recovery, and stale-proposal handling through both backends.

## Verify before building

Read model transport and generation protection code. Do not expand into an unrestricted managed agent, publish/run tools, credential access, or a second MCP server.
