# Phase 12: give provider processes a single lifecycle owner

Date: 2026-10-04. Status: TODO. Risk: high; late handles and callbacks can escape teardown.
Prerequisite: accepted [phase 11](./11-agent-admission.md). Next: [phase 13](./13-agent-composition.md).
Planning revision: `2ae55abb5`; phase 11's accepted coordinator is the queue owner.

## Task and context

Extract live provider generation supervision from `runtimeEngine.ts` into a focused lifecycle owner.
Make startup joining, readiness, stop/retirement, reconnect, and idle/quiet timers understandable.
The engine remains the coordinator for durable events, redaction, publication, and overall shutdown.
The queue coordinator remains the owner of admission scans and queue wakeups.

Current live records hold handles, start/stop promises, abort controllers, retirement failure,
callback work, active/admission turn identity, workspace/provider identity, activity, and generation
state. These fields protect actual races; do not simplify them by dropping ownership checks.

## Starting points and invariants

- `plugins/agents/src/server/sessions/runtimeEngine.ts`: `LiveSession`, `ensureSession`, `startSession`,
  generation checks, provider callback handling, reconnect, quiet/idle sweeps, and `stopLive`.
- `runtime.ts`: direct live-map reads for cancellation, options, handoff, archive, retention, and
  other session commands. Inventory every access before making the map private.
- `runtimeStartup.test.ts`, `runtimeIdleStop.test.ts`, `runtimeQueue.test.ts`, `runtimeTelemetry.test.ts`.
- Drivers' `processOwnership.test.ts`, ACP/Codex tests; durable event buffer/materializer tests.
- [Agent operations](../../managed-agents/operations.md), [credentials](../../security/credentials.md),
  and [process security](../../security/process-and-paths.md).

Startup installs a generation before its first await; concurrent callers join it. A late handle is
retired even if its driver ignores cancellation. Failed retirement forbids replacement. Old events
and reconnects cannot mutate the successor. Readiness waits for saved defaults/product initialization.
Idle stop excludes active/queued turns, pending requests, background children, and startup/retirement.

## Implementation steps

1. Create a lifecycle ownership table for live records, timers, callback joins, readiness holds, abort
   sources, token redaction, event flushes, and stop barriers. Preserve current timeout/reconnect
   policy. Record the exact separation between driver shutdown and plugin/database closure.
2. Extract a provider-session owner beside sessions (new feature module). It alone owns the mutable
   live map and process generation transitions. Accept explicit driver, task/workspace, startup
   configuration, scoped environment, and durable-event callback ports; keep token minting/redaction
   custody singular in the engine. Do not clone the redaction array passed to the materializer.
3. Move ensure/start/stop and process-specific timers in small batches. Preserve registration before
   awaited reads, joined promises, late-handle disposal, generation fencing, active/admission markers,
   reconnect suppression after stop, readiness hold/release, and failure propagation.
4. Expose narrow operations or immutable views needed by admission and product commands: occupancy,
   current generation/turn facts, cancellation, handle commands, stop, and live session IDs. Commands
   that mutate a handle run inside the owner with generation checks; don't export the mutable map.
5. Rewire the phase 11 coordinator to those operations. A reservation must still be counted before
   provider start and released on every completion/failure. Do not snapshot occupancy once at boot.
   Rewire direct `runtime.ts` live access using the same owner operations; retain inheritance until
   phase 13, but make raw live state inaccessible outside its owner.
6. Keep durable event commit and materialization in the engine. Callbacks from the process owner
   enter that existing pipeline with bound generation identity. Preserve event ordering, usage,
   quiet-child settlement, telemetry, and one-turn accepted-response tracking.
7. Keep one visible overall shutdown sequence: abort admission/startups and clear timers, join process
   retirement and scans/callbacks, flush durable events/search, stop webhooks, then permit storage
   closure. Shared abort/generation ownership must not become two competing stop flags.
8. Run existing race tests after each extraction batch. Extend only missing observable cases for a
   late native handle, failed retirement, successor events, idle exclusions, or second boot.

## Verification

```sh
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtimeStartup.test.ts
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtimeIdleStop.test.ts
pnpm test:focus @acorn/plugin-agents src/server/sessions/runtimeQueue.test.ts
pnpm test:focus @acorn/plugin-agents src/server/drivers/processOwnership.test.ts
pnpm lint
pnpm test --filter=@acorn/plugin-agents --filter=@acorn/plugin-workflows --filter=@acorn/node --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
```

Also run focused telemetry, event buffer/materializer, and Node repeated-runtime boot tests at their
current owner. Prove stop returns only after owned children/callbacks are retired and flushed, then
close storage and reboot in the same process. Fake timers must synchronize events, not conceal races.

## Acceptance and handoff

- A single private owner holds live generations and process timers; callers use narrow operations.
- Queue reservations, readiness, late starts, failed retirement, stale callbacks, idle rules, and
  shutdown ordering retain existing proof. No process or timer survives plugin disposal.
- Durable event/secret handling and provider protocol behavior remain unchanged.
- Record owner diagram, operation interface, engine/product remaining dependencies, and test evidence
  in task/table/evidence so phase 13 can remove inheritance without rediscovering lifetimes.
- Rollback restores the owner and all coordinator/runtime call sites together; never clear durable
  sessions, reuse a failed generation, or suppress retirement errors to make tests pass.

## Verify before building

Check phase 11's reservation ports, live-map users, startup/idle tests, and shutdown implementation.
Stop if the design creates two live maps, leaks handles, or moves permission/token scope into callers.
