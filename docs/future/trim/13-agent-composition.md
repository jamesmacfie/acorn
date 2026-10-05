# Phase 13: replace agent runtime inheritance with composition

Completion note, October 6, 2026: `ManagedAgentRuntime` owns one `ManagedAgentEngine` through
composition. The engine creates the only store, attachments, artifacts, MCP store, webhooks,
redaction list, event materializer and buffer, queue coordinator, and provider lifecycle owner.
The facade keeps product reservation, initialization, defaults, title, transcript, configuration,
and retention commands. It calls named engine operations for readiness, checked provider handles,
event recording, queue wakeup, and retirement. Constructor options and public signatures remain.
Transcript commands load on first import, resume verification, or export and share one instance;
this keeps the unchanged Node service graph below its startup budget.

| Observable API before composition | Owner after composition | Consumers and timing |
| --- | --- | --- |
| `store`, `attachments`, `artifacts`, `webhooks`, `mcpServers` | Engine instances, readonly facade references | Routes, delegation, draft capability, data source, testkit; identical object identity and storage lifetime. |
| `providers`, `usableProvider`, `reconcile`, `subscribe`, `stopTaskSessions`, `stopIdleSessions`, `stopIdleSessionsNow`, `processFootprint`, `diskFootprint` | Engine operations, bound facade forwards | Node activation, routes, delegation, storage UI, and process sampling; return types and callbacks stay intact. |
| `createSession`, `acceptSession`, `enqueueTurn`, `implementCodexPlan`, `drainQueue` | Facade admission commands | Workflow, route, and delegation callers; ready return, durable interactive row, and durable queued turn boundaries stay distinct. |
| `applyRequestedConfig`, `customAgents`, `spawnedAgentDefaults`, `regenerateTitle`, `importTranscript`, `verifyImportedResume`, `exportSession` | Facade and product collaborators | Defaults, custom agents, titles, import and export retain their persisted contracts. |
| `cancelTurn`, `patchQueuedTurn`, `resolveRequest`, `compact`, `patchSession`, `sessionMcp`, `setSessionMcpServers`, `fork`, `archive`, `deleteSession`, `handoffToTerminal`, `resumeManaged` | Facade commands over checked engine operations | Routes and delegation; provider generation and request claim rules remain in their existing owners. |
| `captureExecution`, `wait`, `removeArchivedHistory`, `stop` | Facade reads and lifecycle joins | Workflow, delegation, retention, and plugin disposal; one durable event flush and idempotent stop promise. |

| State or lifetime | Owner |
| --- | --- |
| Reservations, initializations, title work | Facade; joined after immediate engine retirement starts. |
| Live generations, callbacks, process timers | `providerSessionLifecycle.ts`, reached through engine operations. |
| Fairness, delayed wake, scan and drain | `queueCoordinator.ts`. |
| Event commit, publication, redaction, search and webhook shutdown | Engine; shared resources are constructed once. |

Decision: retain readonly service references because route and capability consumers use those public
stores. The engine remains private to the facade. Existing lifecycle tests inspect engine-owned
state through test-only access; no production subclass path or public mutable process bag was added.
No schema, API major, route, or persisted ID changed. Phase 14 can examine provider coupling without
moving the process or event ownership described here.

Date: 2026-10-06. Status: DONE. Risk: high; inherited operations are part of current consumers.
Prerequisite: accepted [phase 12](./12-agent-processes.md). Next: [phase 14](./14-provider-boundary.md).
Planning revision: `2ae55abb5`; admission/process owners now come from phases 11–12.

## Task and context

Replace `ManagedAgentRuntime extends ManagedAgentEngine` with a product command facade that owns
an engine instance and delegates through explicit operations. The audited pair totaled 2,125 lines
and exposed numerous protected mutable fields. Earlier phases separated queue and process ownership;
this phase removes the implicit shared-state relationship without changing product commands.

The product facade reserves sessions, applies defaults, owns title generation and initialization,
accepts durable turns, answers requests, changes options, and handles history. The engine supervises
execution and the durable event pipeline. Existing `SessionDefaultsCommands`, `TranscriptCommands`,
and `SessionTitleGeneration` already demonstrate explicit collaborator construction.

## Starting points and contracts

- `plugins/agents/src/server/sessions/runtime.ts`, `runtimeEngine.ts`, `sessionDefaultsCommands.ts`,
  `transcriptCommands.ts`, `sessionTitleGeneration.ts`, and the phase 11–12 owners.
- Construction/consumers in `plugins/agents/src/node/index.ts`, `server/delegation/`, session routes,
  `sessionControl.ts`, `sessionExecute.ts`, testkit, and workflow public capability consumers.
- `plugins/agents/src/contract/`, plugin package exports, and architecture/public-surface snapshots.
- [Managed agents](../../managed-agents.md), [agent operations](../../managed-agents/operations.md),
  [package boundaries](../../architecture/packages.md), and [state ownership](../../state-ownership.md).

`createSession` returns after readiness/defaults; interactive `acceptSession` returns when its row is
durable. `enqueueTurn` acknowledges durable acceptance before startup completes. Public/inherited
methods and exposed stores used by consumers remain available. Stop is idempotent, starts engine
retirement immediately, drains title work, and joins reservations/initializations before returning.

## Implementation steps

1. Inventory the runtime's entire observable API, including inherited members and readonly stores.
   Find consumers through source, package exports, tests, routes, and capability bridges. Record
   signatures, return timing, errors, publication behavior, and shutdown expectations.
2. Define a narrow internal execution interface from actual product needs: running-state reads,
   readiness lifecycle, admission wake, bound provider commands, cancellation/retirement, event
   recording/flushing, subscription, and stop. Reuse phase 12's process operations. Do not expose
   maps, timer fields, mutable state bags, or a generic engine callback that bypasses ownership.
3. Construct the engine once in `ManagedAgentRuntime` using the existing options. Inject product
   collaborators from explicit constructor dependencies and engine operations. Share the same store,
   attachments/artifacts, secret materializer, registry, and event pipeline; do not instantiate doubles.
4. Replace inherited protected reads/writes with the operation interface. Move behavior to its proper
   owner when forwarding would otherwise leak lifecycle state. Product logic keeps configuration,
   transcript/title/history semantics; the engine keeps execution and durable event supervision.
5. Preserve observable methods and constructor/options compatibility through explicit delegation.
   Keep callback `this` binding correct. Keep public readonly service references where consumers need
   them, without publishing new broad engine internals through the plugin API.
6. Remove the inheritance and obsolete protected access only after consumers compile. Do not keep
   a parallel subclass path, compatibility global, or proxy exposing every engine member. Update
   comments and owning docs to explain the composition and singular resource ownership.
7. Preserve stop ordering from phase 12 and product reservation/title joins. A facade must not finish
   before its engine, spawn after shutdown, or write after plugin storage closes. Keep failed stop
   visible. Use the existing runtime tests as consumer tests, not rewritten tests of delegation calls.
8. Exercise interactive, workflow, and delegated fixture sessions through public routes/capabilities:
   durable create/enqueue, options/defaults, request resolution, cancel, resume, transcript import,
   history retention, terminal handoff, and second boot. Use real managed driver process fixtures.

## Verification

```sh
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtime.test.ts
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtimeStartup.test.ts
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtimeQueue.test.ts
pnpm test:focus @acorn/plugin-agents src/server/sessions/sessionControl.test.ts
pnpm test:focus @acorn/plugin-agents src/server/sessions/sessionExecute.test.ts
pnpm lint
pnpm test --filter=@acorn/plugin-agents --filter=@acorn/plugin-workflows --filter=@acorn/node --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
```

Run focused title/default/transcript/history tests for affected owners and real Node route/delegation
integration. Inspect desktop and TUI managed-session flows in isolated `trim-13` sessions using
[local development](../../local-development.md), including streaming focus, pending approvals,
queue edits/cancel, and returning to a session. Stop both hosts and verify owned processes exit.

## Acceptance and handoff

- Runtime uses composition; no engine subclass or protected mutable sharing remains.
- One store/event pipeline/admission/process owner exists. Interfaces express operations and custody.
- Public signatures, durable acceptance/readiness timing, IDs, ledger, and API major 3 remain stable.
- Existing consumer tests, host flows, and architecture checks pass without weakened assertions.
- Record API parity/ownership tables and verification in task/table/evidence for phase 14.
- Rollback restores composition and constructors/call sites together; no migration is required.

## Verify before building

Check preceding interfaces, current consumers and inherited API, product shutdown joins, and package
exports. Stop if removal requires a breaking public contract; preserve it through explicit delegation.
