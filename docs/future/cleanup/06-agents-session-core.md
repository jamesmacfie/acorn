# 06: Agents session core

> **Completion note, October 11, 2026.** `ManagedAgentRuntime` is the one object routes, capabilities,
> and the composition root call, and it has no forwarding member. `AgentStore` is one class. The
> Codex plan handoff lives in `plugins/agents/src/server/drivers/codexPlanHandoff.ts`, and the
> acceptance `git grep` returns nothing. `pnpm lint`, the arch tests, and the `@acorn/plugin-agents`
> and `@acorn/node` suites pass on Node 26.8.1. In `pnpm dev:agent`, a managed Claude session and a
> Codex session each completed a turn through the Node API, and `POST /v1/p/agents/stop-idle` stopped
> both processes.
>
> What landed:
>
> - The runtime takes its engine as an optional second constructor argument,
>   `new ManagedAgentRuntime(options, engine?)`. Production passes one argument. The three test
>   subclasses are gone, and so is every `runtime['engine']` reach in tests. A test that drives the
>   engine builds `new ManagedAgentEngine(options)` and passes it in.
> - That needed the engine to stop calling back into the runtime. Turn acceptance (the `before-send`
>   hook, input checks, checkout admission, the queue write, and the wake-up) moved into
>   `ManagedAgentEngine.acceptTurn`, so a goal's continuation queues its turn without the runtime.
>   `runtime.enqueueTurn` calls it and then starts title generation. `TurnVetoedError` moved with it.
> - Each of the 17 forwarders went to an owner the caller reaches directly:
>   - `runtime.providers` is a `ProviderCatalogue` (`sessions/providerCatalogue.ts`): `list`,
>     `usable`, `observed`, and `readBlockProviders`. The engine never used the probe cache.
>   - `runtime.frames` is a `SessionFrames` (`sessions/sessionFrames.ts`): `subscribe`, `emit`, and
>     the changed-row check. It holds the listeners, the last broadcast rows, the webhook hand-off,
>     and the `agent-session:changed` announcement.
>   - `runtime.upkeep` is a `ProcessUpkeep` (`sessions/processUpkeep.ts`): task-archive stops, idle
>     stops, the Settings stop, both footprints, and the telemetry sample.
>   - `runtime.instructionAdmission` and `runtime.mcpReviews` are `LazyService`s
>     (`sessions/lazyService.ts`), with `get()` and `built()`. Session goals use one inside the engine.
>   - `reconcile` and `loopHook` moved into the runtime as real methods. The bridge's held asks moved
>     with `loopHook`, so `resolveRequest` answers them in the same class.
> - The runtime no longer exposes `webhooks`, which nothing outside used. `archive(sessionId, flag)`
>   is gone. Only tests called it, and they call `patchSession`.
> - `AgentSessionRepository` is merged into `AgentStore`. `sessionRepository.ts` is deleted, and its
>   roster test is `subagentRoster.test.ts`.
> - The store keeps the transaction the handoff needs as a generic method, `enqueueAfterLatestTurn`.
>   The handoff passes it a function that checks the proposal and rewrites the options. The old
>   `store.test.ts` held only handoff tests, so it moved to `drivers/codexPlanHandoff.test.ts`.
> - `docs/managed-agents/operations.md`, `providers.md`, `sessions.md`, `session-events.md`, and
>   `harnesses.md` name the new owners.
>
> Decisions and deviations:
>
> - **The engine still builds the store, attachments, artifacts, MCP servers, and the new
>   collaborators, and the runtime holds the same instances as fields.** The engine's `stop()`
>   closes them in order, and the injected-engine tests need one construction path. No runtime
>   method passes a call through to the engine.
> - **One class, ordered as before, not split by aggregate.** `store.ts` is 1,706 lines, which makes
>   it the largest hand-written file. Splitting it into session, turn, event, and request classes
>   would break "one store class owns the session tables" and change every caller that reads
>   `runtime.store`. Proposal 14 can take it on.
> - **A few one-line user commands stay on the runtime**: `setGoal`, `resumeGoal`, `regenerateTitle`,
>   `applyRequestedConfig`, `importTranscript`, `verifyImportedResume`, and `drainQueue`. Requirement 2
>   keeps user commands on the public object. Each reaches a command module that loads on first use,
>   and routes shouldn't handle that loading.
> - **The provider catalogue clears its cache when shutdown starts**, not after the engine's drain. A
>   `providers.list()` call during shutdown rejects instead of serving the last answer.
> - Leftover `protected` modifiers in the engine are `private`, since nothing subclasses it.
> - I ran the agents suite after each of the three steps and the real-app check once at the end,
>   because all three land in one commit.
>
> For later phases: a caller outside `sessions/` reaches the runtime and its fields, never the
> engine. A new user command goes on the runtime. New process, frame, or provider behavior goes on
> the collaborator that owns it.

This proposal reshapes the managed-agent session core in the agents plugin. It should end with one
public runtime object and one store, split by responsibility instead of by inheritance and
forwarding.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md).
Part of the [cleanup programme](./README.md).

## Problem

`plugins/agents/src/server/sessions/` holds 71 source files, the largest folder in the repository.
At its center sit four classes in two pairs:

- `AgentStore` in `store.ts`, 945 lines, extends `AgentSessionRepository` in
  `sessionRepository.ts`, 770 lines. The split follows a subclass line, not a table or an aggregate,
  so a reader looking for a query has to check both.
- `ManagedAgentRuntime` in `runtime.ts`, 926 lines, wraps `ManagedAgentEngine` in `runtimeEngine.ts`,
  1,364 lines. The runtime re-exposes five engine fields and adds 17 one-line forwarders, at
  `runtime.ts` lines 122 to 138. A caller can reach either layer, and three test files subclass the
  runtime: `sessionWait.test.ts`, `runtimeStartup.test.ts`, and `runtimeQueue.test.ts`.

The header comment says the engine owns process supervision, event durability, and scheduling, and
the runtime owns lifecycle and user commands. The forwarders blur that line, because most runtime
methods only pass a call through.

Provider-specific logic also sits in the generic store. `AgentStore.acceptCodexPlan`, at `store.ts`
line 36, rewrites Codex configuration options and renames `reasoning` to `effort` inside a store
transaction.

The two runtime files are the agents plugin's most-changed code, and the type error in
[01: green the gate](./01-green-the-gate.md) came from them.

## Goal

A reader can find where a session command, a provider event, and a database write live without
reading four classes. Routes and capabilities talk to one object.

## Requirements

1. Choose one public object for routes, capabilities, and the composition root. The runtime is the
   natural choice. Make the engine internal to it.
2. Delete each forwarder. Have the caller call the object that owns the behavior, or move the
   behavior to the public object if it is a user command.
3. Merge `AgentSessionRepository` into the store, or split the merged code by aggregate (sessions,
   turns, events, requests). Don't split by subclass.
4. Move the Codex plan handoff, `acceptCodexPlan` and its option rewriting, beside the Codex driver
   in `plugins/agents/src/server/drivers/`. Keep the store's part to the transaction it needs.
5. Replace the test subclasses with injected dependencies, so tests don't depend on the class
   hierarchy.
6. Keep every route, capability, persisted row, and wire event the same.

## Out of scope

The driver layer, the delegation service, and the client session store. Each has its own size
problems, but this proposal is already large.

## Risks

This is the product's core. Land it in steps: forwarders first, then the store merge, then the Codex
move. Run the full agents suite and a real `pnpm dev:agent` session turn after each.

## Acceptance

- `runtime.ts` has no forwarding member.
- One store class owns the session tables.
- `git grep -n "codexModeOption\|'reasoning' ? 'effort'" plugins/agents/src/server/sessions/` returns
  nothing.
- `pnpm test --filter=@acorn/plugin-agents` passes, and a managed Claude and Codex turn completes in
  `pnpm dev:agent`.
