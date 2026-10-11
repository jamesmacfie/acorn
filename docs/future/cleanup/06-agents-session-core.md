# 06: Agents session core

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
