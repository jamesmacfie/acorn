# Phase 12: give provider processes a single lifecycle owner

Completion note, October 6, 2026: `providerSessionLifecycle.ts` owns the private live map,
generation identity, start and retirement promises, process handles, readiness holds, callback joins,
and reconnect, quiet-child, idle, and process-sample timers. `runtimeEngine.ts` supplies typed task,
workspace, history, scoped-environment, MCP, durable-event, and telemetry ports. It retains token
minting and one redaction array shared with materialization, durable event commit, publication,
dispatch outcomes, and the visible overall stop sequence. `queueCoordinator.ts` remains the only
scan, wake, fairness, and drain owner; its `started = started || dispatched` correction and durable
head revalidation remain in place.

```text
runtime.ts product commands ─┐
queueCoordinator.ts scans ────┼──> providerSessionLifecycle.ts ──> driver child
runtimeEngine.ts dispatch ────┘             │
                                            └── bound generation callbacks ──> engine durable pipeline
```

| Lifetime or state | Owner and stop barrier |
| --- | --- |
| Live records, generation transitions, admission and active markers, accepted response, late handles | Lifecycle owner; generation checked before transitions and handle commands; failed retirement leaves its generation installed. |
| Startup and readiness | Lifecycle owner installs before awaited task, workspace, history, environment, or MCP work; concurrent callers join; product initialization releases readiness. |
| Reconnect, quiet-child, idle, and footprint timers | Lifecycle owner clears all at engine stop; queue owns only its delayed-head wake timer. |
| Provider callbacks and process retirement | Lifecycle owner joins callbacks for each stopped generation, then joins all owned children before engine event flushing. |
| Scoped token and provider/MCP secret redaction | Engine mints and appends to its single mutable redaction array; the materializer holds that same array. |
| Durable events, search, publication, and webhooks | Engine joins provider retirement and queue scans, flushes event buffer and search, joins publication callbacks, then stops webhooks before plugin storage closes. |

The owner exposes immutable `current`, `occupancy`, and `ids` facts; `ensure`, `owns`, `activate`,
`release`, `clearActive`, and `takeActive` generation operations; checked handle commands; and
`stop`, `stopAll`, `abortAndClearTimers`, and `joinCallbacks`. Callers receive generation identities,
not live records. The durable buffer carries an internal optional generation identity so a queued
event cannot settle a successor's active marker or span. No wire, schema, or plugin API changed.

Phase 13 still needs to replace `ManagedAgentRuntime extends ManagedAgentEngine`. Product commands
still use the engine's protected store, record, pump, readiness, and stop methods; the engine still
coordinates dispatch outcomes and durability. The extraction kept these dependencies visible instead
of moving product policy into the process owner. The owner accepts no duplicate shutdown flag and
does not hold a second redaction list. The process timer move includes footprint sampling, which was
engine-held before this phase. The process and disk footprint helper loads when measured, keeping it
out of the service boot graph. See [phase 12 evidence](./evidence.md#phase-12-provider-processes-2026-10-06)
for the bounded gates and shutdown/reboot proof.

Date: 2026-10-06. Status: DONE. Risk: high; late handles and callbacks can escape teardown.
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
