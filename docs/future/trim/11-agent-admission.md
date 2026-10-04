# Phase 11: separate durable turn admission and queue coordination

Date: 2026-10-04. Status: TODO. Risk: high; scheduling races can duplicate or strand work.
Prerequisite: accepted [phase 10](./10-plugin-host.md). Next: [phase 12](./12-agent-processes.md).
Planning revision: `2ae55abb5`; retain phase 01's runtime behavior inventory.

## Task and context

Extract queue coordination from `plugins/agents/src/server/sessions/runtimeEngine.ts` into one
feature-owned coordinator. The audited `pump()` spanned about 202 lines inside a 1,312-line engine.
Make admission policy and coordination understandable while retaining exact durable behavior.
Do not change fairness, retry limits, database schema, or provider APIs in this phase.

`runtime.ts` writes accepted turns before scheduling. The engine reads durable queue heads, counts
active and startup-reserved slots, selects eligible work, starts a provider, rereads the durable head,
and sends that turn. Provider callbacks settle it and trigger further scans. This acceptance boundary
must survive startup failures, cancellation, edits, reorder, deferred continuation, and restart.

## Starting points and invariants

- `runtimeEngine.ts`: `pump`, queue wake timer, pumping/requested flags, idle waiters, fairness streak,
  startup admission, dispatch, accepted-response tracking, and safe-transient retry handling.
- `runtime.ts`: `enqueueTurn`, `drainQueue`, `cancelTurn`, `patchQueuedTurn`, and shutdown.
- `store.ts`, `stateMachine.ts`, `usageContinuation.ts`, `runtimeQueue.test.ts`, `runtime.test.ts`,
  `runtimeStartup.test.ts`, and driver fake fixtures under the same plugin.
- [Agent operations](../../managed-agents/operations.md) and [managed agents](../../managed-agents.md).

Preserve one dispatched turn per session; provider/workspace ceilings include startup reservations.
Read limits per pass. Lower limits never cancel active work. Earliest deferred heads block later turns.
Interactive/automation work yields after five dispatches. Calls arriving during a scan request another
pass even when the current pass starts nothing. Text events must not cause unnecessary scans.

## Implementation steps

1. Map every pump trigger and state read/write, including shutdown and usage-limit wakeups. Identify
   which state belongs to coordination vs live provider generations. Recheck existing tests before
   adding any. Record the current ordering and await-time revalidation points.
2. Extract pure eligibility/order rules only where they naturally accept data and return a decision.
   Preserve tie ordering, time checks, source classification, per-pass failed-start suppression, and
   fairness semantics. Do not replace durable queue queries with a cached in-memory queue.
3. Create one queue coordinator beside sessions (new module; follow existing naming conventions).
   It owns pumping/requested flags, fairness streak, queue wake state, and drain waiters. Give it
   explicit ports for durable head reads, fresh limits, live occupancy, workspace resolution,
   startup/reservation, dispatch, and shutdown. Keep each port tied to an actual operation.
4. Move the scan/dispatch sequence without reordering awaits. After each held startup or read, verify
   the generation still belongs to this session, the current row is eligible, and the durable head
   still matches. Dispatch the freshly reread edited input. Reserve ceilings before provider start.
5. Keep safe retry classification and accepted-response guards next to dispatch outcome handling.
   Preserve the existing maximum attempts, diagnostics, requeue state, and no retry of uncertain
   accepted work. Usage-limit continuation retains turn ID, source, input, and persisted not-before.
6. Route all engine/runtime pump triggers through this coordinator. There must be no second set of
   flags or timer left behind. Shutdown closes admission immediately, cancels wakeups, and awaits
   scans; event buffering and provider retirement remain with the engine pending phase 12.
7. Adapt existing tests through `ManagedAgentRuntime`, not by exposing coordinator internals. Use
   held fake-provider starts and store reads to prove cancellation, edit/reorder, durable acceptance,
   limit accounting, repump, fairness, delayed heads, retry, and shutdown. Add only missing cases.

## Verification

```sh
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtimeQueue.test.ts
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtimeStartup.test.ts
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtime.test.ts
pnpm lint
pnpm test --filter=@acorn/plugin-agents --filter=@acorn/plugin-workflows --filter=@acorn/node --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
```

Include usage continuation tests and workflow managed-execution integration. Test bursts through the
public enqueue path while starts are held. Repeat startup/cancel/stop on one runtime, then boot a new
runtime against the same fixture DB to prove accepted work survives without callbacks from the old one.

## Acceptance and handoff

- One coordinator owns scan serialization, fairness, delayed wake, and drain. The engine supplies
  typed operations; no generic scheduler framework or shared mutable bag is introduced.
- Durable acceptance, exact queue identity, ceilings, fairness, safe retry, and shutdown tests pass.
- Public methods, event ordering, ledger/storage formats, defaults, and workflow completion remain.
- Task/table/evidence records the coordinator ports and live-state accesses that phase 12 must replace.
- If preservation fails, restore the engine and extracted coordinator together. Do not repair by
  changing retry policy, dropping accepted turns, or adding sleeps to race tests.

## Verify before building

Inspect live queue queries, continuation/retry policy, all pump callers, and the accepted baseline.
Stop if an extraction changes durable acknowledgement or requires a schema or scheduling-policy change.
